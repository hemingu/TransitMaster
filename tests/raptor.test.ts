import { describe, expect, it } from 'vitest';
import { searchRoute } from '../src/lib/raptor.ts';
import { FIXTURE_EXPECTATIONS, miniNetwork } from './fixtures/miniEkidata.ts';
import type { Line, Network, Station } from '../src/lib/types.ts';

// ---- miniNetwork() の station index 定数（フィクスチャのコメントと対応させる） ----
const S_TOKYO_YAMANOTE = 0;
const S_TOKYO_CHUO = 1;
const S_KANDA = 3;
const S_UENO = 5;
const S_SHINJUKU_YAMANOTE = 8;
const S_SHINJUKU_CHUO = 9;
const S_SHINJUKU_TESTTETSU = 11;
const S_SHINAGAWA = 13;
const S_OTEMACHI = 16;
const S_HIGASHIYAMA = 21;
const S_NISHIOKA = 22;

function lineIndexByName(network: Network, name: string): number {
  const idx = network.lines.findIndex((l) => l.name === name);
  if (idx === -1) throw new Error(`line not found: ${name}`);
  return idx;
}

describe('searchRoute', () => {
  const network = miniNetwork();

  it('東京->新宿(time): 中央線直通660秒・乗換0（FIXTURE_EXPECTATIONS.tokyoToShinjuku）', () => {
    const itin = searchRoute(network, S_TOKYO_CHUO, S_SHINJUKU_CHUO, 'time');
    expect(itin).not.toBeNull();
    const result = itin!;

    expect(result.totalSec).toBe(FIXTURE_EXPECTATIONS.tokyoToShinjuku.time.totalSec);
    expect(result.transfers).toBe(FIXTURE_EXPECTATIONS.tokyoToShinjuku.time.transfers);
    expect(result.legs).toHaveLength(1);
    expect(network.lines[result.legs[0].line].name).toBe(
      FIXTURE_EXPECTATIONS.tokyoToShinjuku.time.line
    );
  });

  it('品川->上野: 環状の短い側720秒（モジュラー走査の回帰テスト）', () => {
    const itin = searchRoute(network, S_SHINAGAWA, S_UENO, 'time');
    expect(itin).not.toBeNull();
    const result = itin!;

    expect(result.totalSec).toBe(FIXTURE_EXPECTATIONS.shinagawaToUeno.time.totalSec);
    expect(result.transfers).toBe(FIXTURE_EXPECTATIONS.shinagawaToUeno.time.transfers);
    expect(result.legs).toHaveLength(1);
    expect(network.lines[result.legs[0].line].name).toBe('山手線');
    // 品川->東京->神田->秋葉原->上野 の東京経由（短い側）であること
    expect(result.legs[0].from).toBe(S_SHINAGAWA);
    expect(result.legs[0].to).toBe(S_UENO);
  });

  it('東山->大手町: transfersモードとtimeモードで最適解が分岐する', () => {
    const transfersItin = searchRoute(network, S_HIGASHIYAMA, S_OTEMACHI, 'transfers');
    expect(transfersItin).not.toBeNull();
    expect(transfersItin!.totalSec).toBe(
      FIXTURE_EXPECTATIONS.higashiyamaToOtemachi.transfersMode.totalSec
    );
    expect(transfersItin!.transfers).toBe(
      FIXTURE_EXPECTATIONS.higashiyamaToOtemachi.transfersMode.transfers
    );

    const timeItin = searchRoute(network, S_HIGASHIYAMA, S_OTEMACHI, 'time');
    expect(timeItin).not.toBeNull();
    expect(timeItin!.totalSec).toBe(FIXTURE_EXPECTATIONS.higashiyamaToOtemachi.timeMode.totalSec);
    expect(timeItin!.transfers).toBe(FIXTURE_EXPECTATIONS.higashiyamaToOtemachi.timeMode.transfers);
  });

  it('東山->西丘: 分岐またぎパターンで乗換0回400秒', () => {
    const itin = searchRoute(network, S_HIGASHIYAMA, S_NISHIOKA, 'time');
    expect(itin).not.toBeNull();
    const result = itin!;

    expect(result.totalSec).toBe(FIXTURE_EXPECTATIONS.higashiyamaToNishioka.time.totalSec);
    expect(result.transfers).toBe(FIXTURE_EXPECTATIONS.higashiyamaToNishioka.time.transfers);
    expect(result.legs).toHaveLength(1);
    expect(network.lines[result.legs[0].line].name).toBe('テスト電鉄本線');
  });

  it('後退方向乗車: 新宿->東京は中央線を逆走して660秒', () => {
    const itin = searchRoute(network, S_SHINJUKU_CHUO, S_TOKYO_CHUO, 'time');
    expect(itin).not.toBeNull();
    const result = itin!;

    expect(result.totalSec).toBe(660);
    expect(result.transfers).toBe(0);
    expect(result.legs).toHaveLength(1);
    expect(network.lines[result.legs[0].line].name).toBe('中央線');
    expect(result.legs[0].from).toBe(S_SHINJUKU_CHUO);
    expect(result.legs[0].to).toBe(S_TOKYO_CHUO);
  });

  it('乗換ペナルティの非二重加算: totalSec = rideSec + transfers*300 が複数経路で成立する', () => {
    const cases: [number, number, 'time' | 'transfers'][] = [
      [S_TOKYO_CHUO, S_SHINJUKU_CHUO, 'time'],
      [S_SHINAGAWA, S_UENO, 'time'],
      [S_HIGASHIYAMA, S_OTEMACHI, 'transfers'],
      [S_HIGASHIYAMA, S_OTEMACHI, 'time'],
      [S_HIGASHIYAMA, S_NISHIOKA, 'time'],
    ];

    for (const [from, to, mode] of cases) {
      const itin = searchRoute(network, from, to, mode);
      expect(itin).not.toBeNull();
      const result = itin!;
      expect(result.totalSec).toBe(result.rideSec + result.transfers * network.transferSec);
    }
  });

  it('同一グループ（東京の山手線レコード<->東京のメトロレコード）は null', () => {
    const marunouchiLineIdx = lineIndexByName(network, '丸ノ内線');
    const marunouchiPattern = network.lines[marunouchiLineIdx].patterns[0];
    // 丸ノ内線の東京レコード（S_TOKYO_MARUNOUCHI = 2）は東京グループと同一
    const tokyoMarunouchi = marunouchiPattern.stops[3]; // [池袋,御茶ノ水,大手町,東京,四ツ谷,新宿]のpos3
    expect(network.stations[tokyoMarunouchi].group).toBe(network.stations[S_TOKYO_YAMANOTE].group);

    const itin = searchRoute(network, S_TOKYO_YAMANOTE, tokyoMarunouchi, 'time');
    expect(itin).toBeNull();
  });

  it('到達不能な駅（孤立駅）へは null を返す', () => {
    const isolatedStations: Station[] = [
      ...miniNetwork().stations,
      { name: '孤立駅', lat: 0, lon: 0, group: 999, pref: 0 },
    ];
    const isolatedLines: Line[] = miniNetwork().lines; // 孤立駅を参照するパターンは存在しない
    const isolatedNetwork: Network = {
      formatVersion: 2,
      stations: isolatedStations,
      lines: isolatedLines,
      transferSec: 300,
    };
    const isolatedIdx = isolatedStations.length - 1;

    const itin = searchRoute(isolatedNetwork, S_TOKYO_YAMANOTE, isolatedIdx, 'time');
    expect(itin).toBeNull();
  });

  it('legs の from/to は乗車路線の stops 上の駅indexである', () => {
    const itin = searchRoute(network, S_HIGASHIYAMA, S_OTEMACHI, 'transfers');
    expect(itin).not.toBeNull();
    const result = itin!;

    for (const leg of result.legs) {
      const line = network.lines[leg.line];
      const onSomePattern = line.patterns.some(
        (p) => p.stops.includes(leg.from) && p.stops.includes(leg.to)
      );
      expect(onSomePattern).toBe(true);
    }

    // legの連結性: 前legのtoと次legのfromは同一グループであること
    for (let i = 0; i < result.legs.length - 1; i++) {
      const cur = result.legs[i];
      const next = result.legs[i + 1];
      expect(network.stations[cur.to].group).toBe(network.stations[next.from].group);
    }

    expect(result.transfers).toBe(result.legs.length - 1);
  });

  it('山手線の全区間で前進・後退どちらの乗車も他方向より短い側が選ばれる（新宿->品川）', () => {
    // 新宿(yamanote)->品川: 正方向(渋谷経由)400+200=600秒、逆方向(池袋,上野...経由)は長いので正方向が最短
    const itin = searchRoute(network, S_SHINJUKU_YAMANOTE, S_SHINAGAWA, 'time');
    expect(itin).not.toBeNull();
    const result = itin!;
    expect(result.totalSec).toBe(600);
    expect(result.legs[0].from).toBe(S_SHINJUKU_YAMANOTE);
    expect(result.legs[0].to).toBe(S_SHINAGAWA);
  });

  it('山手線: 神田->東京(逆走・環状の始端をまたがない短距離)は200秒', () => {
    const itin = searchRoute(network, S_KANDA, S_TOKYO_YAMANOTE, 'time');
    expect(itin).not.toBeNull();
    expect(itin!.totalSec).toBe(200);
    expect(itin!.transfers).toBe(0);
  });
});

describe('searchRoute: excludeShinkansen（新幹線は「日本全国」エリア限定ルール）', () => {
  /**
   * 新幹線（lineType 1）と在来線（lineType 2）が並行する小ネットワーク。
   * - 中央・東港: 両路線が停車（別レコード・同一グループ）
   * - 山里: 新幹線のみ停車する新幹線単独駅
   * 新幹線 中央->東港 は100秒、在来線 中央->東港 は1000秒。
   */
  function shinkansenNetwork(): Network {
    return {
      formatVersion: 2,
      stations: [
        { name: '中央', lat: 35, lon: 139, group: 0, pref: 13 }, // 0 新幹線
        { name: '東港', lat: 35.1, lon: 139.5, group: 1, pref: 13 }, // 1 新幹線
        { name: '山里', lat: 35.2, lon: 140, group: 2, pref: 0 }, // 2 新幹線単独駅
        { name: '中央', lat: 35, lon: 139, group: 0, pref: 13 }, // 3 在来線
        { name: '東港', lat: 35.1, lon: 139.5, group: 1, pref: 13 }, // 4 在来線
      ],
      lines: [
        {
          name: 'テスト新幹線',
          company: 'テスト鉄道',
          color: null,
          lineType: 1,
          patterns: [{ stops: [0, 1, 2], segSec: [100, 100] }],
        },
        {
          name: 'テスト在来線',
          company: 'テスト鉄道',
          color: null,
          lineType: 2,
          patterns: [{ stops: [3, 4], segSec: [1000] }],
        },
      ],
      transferSec: 300,
    };
  }

  it('デフォルト（除外なし）では新幹線経路が選ばれる', () => {
    const net = shinkansenNetwork();
    const itin = searchRoute(net, 0, 1, 'time');
    expect(itin).not.toBeNull();
    expect(itin!.totalSec).toBe(100);
    expect(net.lines[itin!.legs[0].line].lineType).toBe(1);
  });

  it('excludeShinkansen: 新幹線を使わず在来線経路が選ばれる', () => {
    const net = shinkansenNetwork();
    const itin = searchRoute(net, 0, 1, 'time', { excludeShinkansen: true });
    expect(itin).not.toBeNull();
    expect(itin!.totalSec).toBe(1000);
    expect(net.lines[itin!.legs[0].line].lineType).toBe(2);
    // 全legが新幹線以外であること
    for (const leg of itin!.legs) {
      expect(net.lines[leg.line].lineType).not.toBe(1);
    }
  });

  it('excludeShinkansen: 新幹線でしか到達できない駅（山里）へは null', () => {
    const net = shinkansenNetwork();
    // 除外なしなら到達できる
    expect(searchRoute(net, 0, 2, 'time')).not.toBeNull();
    // 除外すると到達不能
    expect(searchRoute(net, 0, 2, 'time', { excludeShinkansen: true })).toBeNull();
  });

  it('excludeShinkansen: transfers モードでも新幹線を使わない', () => {
    const net = shinkansenNetwork();
    const itin = searchRoute(net, 0, 1, 'transfers', { excludeShinkansen: true });
    expect(itin).not.toBeNull();
    for (const leg of itin!.legs) {
      expect(net.lines[leg.line].lineType).not.toBe(1);
    }
  });
});
