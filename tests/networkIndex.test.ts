import { describe, expect, it } from 'vitest';
import { getNetworkIndex } from '../src/lib/networkIndex.ts';
import { miniNetwork } from './fixtures/miniEkidata.ts';

describe('getNetworkIndex', () => {
  it('groupMembers: 同一groupの駅indexを正しく束ねる', () => {
    const network = miniNetwork();
    const index = getNetworkIndex(network);

    // 新宿は yamanote/chuo/marunouchi/testtetsu の4レコード（station index 8,9,10,11）で group=5
    const shinjukuGroup = network.stations[8].group;
    const members = index.groupMembers.get(shinjukuGroup);
    expect(members).toBeDefined();
    expect(new Set(members)).toEqual(new Set([8, 9, 10, 11]));

    // 東京は yamanote/chuo/marunouchi の3レコード（station index 0,1,2）
    const tokyoGroup = network.stations[0].group;
    const tokyoMembers = index.groupMembers.get(tokyoGroup);
    expect(new Set(tokyoMembers)).toEqual(new Set([0, 1, 2]));

    // 神田はyamanoteのみの1レコード（station index 3）
    const kandaGroup = network.stations[3].group;
    expect(index.groupMembers.get(kandaGroup)).toEqual([3]);
  });

  it('stationPatterns: 環状パターンの再掲駅が二重登録されない', () => {
    const network = miniNetwork();
    const index = getNetworkIndex(network);

    const yamanoteLineIdx = network.lines.findIndex((l) => l.name === '山手線');
    const yamanotePatternIdx = 0;
    const tokyoYamanoteStationIdx = 0; // stops[0] === stops[8] === この駅

    const refs = index.stationPatterns[tokyoYamanoteStationIdx].filter(
      (r) => r.line === yamanoteLineIdx && r.pattern === yamanotePatternIdx
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].pos).toBe(0); // 先頭posのみ登録、末尾(pos=8)は登録されない
  });

  it('stationPatterns: 非環状パターンの各駅は1回ずつ登録される', () => {
    const network = miniNetwork();
    const index = getNetworkIndex(network);

    const chuoLineIdx = network.lines.findIndex((l) => l.name === '中央線');
    const chuoPattern = network.lines[chuoLineIdx].patterns[0];

    chuoPattern.stops.forEach((stationIdx, pos) => {
      const refs = index.stationPatterns[stationIdx].filter((r) => r.line === chuoLineIdx);
      expect(refs).toHaveLength(1);
      expect(refs[0].pos).toBe(pos);
    });
  });

  it('stationPatterns: テスト電鉄の分岐駅（本村）は3パターンすべてから参照される', () => {
    const network = miniNetwork();
    const index = getNetworkIndex(network);

    const testTetsuLineIdx = network.lines.findIndex((l) => l.name === 'テスト電鉄本線');
    const honmuraStationIdx = network.lines[testTetsuLineIdx].patterns[0].stops[2]; // [新宿,初台,本村,東山]のpos2

    const refs = index.stationPatterns[honmuraStationIdx].filter((r) => r.line === testTetsuLineIdx);
    expect(refs).toHaveLength(3);
    const patternIdxSet = new Set(refs.map((r) => r.pattern));
    expect(patternIdxSet).toEqual(new Set([0, 1, 2]));
  });

  it('cumSec: 各パターンの累積所要秒が正しい', () => {
    const network = miniNetwork();
    const index = getNetworkIndex(network);

    const chuoLineIdx = network.lines.findIndex((l) => l.name === '中央線');
    // segSec [180, 240, 240] -> cum [0, 180, 420, 660]
    expect(index.cumSec[chuoLineIdx][0]).toEqual([0, 180, 420, 660]);

    const marunouchiLineIdx = network.lines.findIndex((l) => l.name === '丸ノ内線');
    // segSec [420, 300, 300, 600, 600] -> cum [0, 420, 720, 1020, 1620, 2220]
    expect(index.cumSec[marunouchiLineIdx][0]).toEqual([0, 420, 720, 1020, 1620, 2220]);

    const yamanoteLineIdx = network.lines.findIndex((l) => l.name === '山手線');
    // segSec [200,200,200,300,300,400,200,120] -> cum [0,200,400,600,900,1200,1600,1800,1920]
    expect(index.cumSec[yamanoteLineIdx][0]).toEqual([0, 200, 400, 600, 900, 1200, 1600, 1800, 1920]);

    // cumSec[line][pattern][0] は常に0、配列長はstops.lengthと一致
    for (let lineIdx = 0; lineIdx < network.lines.length; lineIdx++) {
      const line = network.lines[lineIdx];
      for (let patternIdx = 0; patternIdx < line.patterns.length; patternIdx++) {
        const pattern = line.patterns[patternIdx];
        const cum = index.cumSec[lineIdx][patternIdx];
        expect(cum[0]).toBe(0);
        expect(cum).toHaveLength(pattern.stops.length);
        expect(cum[cum.length - 1]).toBe(pattern.segSec.reduce((a, b) => a + b, 0));
      }
    }
  });

  it('lineGroups: 各路線が停車するgroupの集合が正しい', () => {
    const network = miniNetwork();
    const index = getNetworkIndex(network);

    const chuoLineIdx = network.lines.findIndex((l) => l.name === '中央線');
    const chuoGroups = index.lineGroups[chuoLineIdx];
    // 中央線: 東京, 御茶ノ水, 四ツ谷, 新宿 の4グループ
    expect(chuoGroups.size).toBe(4);
    expect(chuoGroups.has(network.stations[1].group)).toBe(true); // 東京(chuo)
    expect(chuoGroups.has(network.stations[9].group)).toBe(true); // 新宿(chuo)

    const testTetsuLineIdx = network.lines.findIndex((l) => l.name === 'テスト電鉄本線');
    const testTetsuGroups = index.lineGroups[testTetsuLineIdx];
    // テスト電鉄: 新宿, 初台, 本村, 東山, 西丘 の5グループ（3パターン合算、重複除去）
    expect(testTetsuGroups.size).toBe(5);
  });

  it('isRing: 環状パターンのみtrueと判定される', () => {
    const network = miniNetwork();
    const index = getNetworkIndex(network);

    const yamanoteLineIdx = network.lines.findIndex((l) => l.name === '山手線');
    expect(index.isRing[yamanoteLineIdx][0]).toBe(true);

    const chuoLineIdx = network.lines.findIndex((l) => l.name === '中央線');
    expect(index.isRing[chuoLineIdx][0]).toBe(false);

    const marunouchiLineIdx = network.lines.findIndex((l) => l.name === '丸ノ内線');
    expect(index.isRing[marunouchiLineIdx][0]).toBe(false);

    const testTetsuLineIdx = network.lines.findIndex((l) => l.name === 'テスト電鉄本線');
    for (const ring of index.isRing[testTetsuLineIdx]) {
      expect(ring).toBe(false);
    }
  });

  it('WeakMapメモ化: 同一Network参照に対して同一のNetworkIndexオブジェクトを返す', () => {
    const network = miniNetwork();
    const index1 = getNetworkIndex(network);
    const index2 = getNetworkIndex(network);
    expect(index1).toBe(index2);

    // 別インスタンスのNetworkであれば別のNetworkIndexが返る
    const network2 = miniNetwork();
    const index3 = getNetworkIndex(network2);
    expect(index3).not.toBe(index1);
  });
});
