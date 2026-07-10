import { describe, expect, it } from 'vitest';
import { generateQuestion } from '../src/lib/question.ts';
import { miniNetwork } from './fixtures/miniEkidata.ts';
import type { Network } from '../src/lib/types.ts';

/** 決定的な rng: 与えた値を順番に返し、末尾に達したら先頭に戻る */
function makeSeededRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/**
 * generateQuestion 内の選定ロジック（originIdx = floor(rng()*len),
 * destIdx = floor(rng()*(len-1)) で destIdx>=originIdx なら+1）から逆算し、
 * areaStations 配列中の位置 originPos / destPos を狙い撃つ rng を作る。
 */
function rngTargeting(areaStations: number[], originStation: number, destStation: number): () => number {
  const len = areaStations.length;
  const originPos = areaStations.indexOf(originStation);
  const destPos = areaStations.indexOf(destStation);
  if (originPos === -1 || destPos === -1) throw new Error('station not in areaStations');
  const originR = (originPos + 0.001) / len;
  const destBase = destPos > originPos ? destPos - 1 : destPos;
  const destR = (destBase + 0.001) / (len - 1);
  return makeSeededRng([originR, destR]);
}

function stationOnLine(network: Network, lineName: string, name: string): number {
  const line = network.lines.find((l) => l.name === lineName);
  if (!line) throw new Error(`line not found: ${lineName}`);
  for (const pattern of line.patterns) {
    for (const stopIdx of pattern.stops) {
      if (network.stations[stopIdx].name === name) return stopIdx;
    }
  }
  throw new Error(`station ${name} not found on line ${lineName}`);
}

describe('generateQuestion (miniNetwork)', () => {
  const network = miniNetwork();
  const allStations = network.stations.map((_, i) => i);

  it('上野→新宿(山手線) の問題は minTransfers=1 になる', () => {
    // 山手線のみで到達可能な上野からは、新宿(山手線)へ直通(乗換0)できてしまうため、
    // 乗換1回が最小になるペアとして「上野(山手線)→新宿(中央線専用駅)」を使う代わりに、
    // ここでは中央線・丸ノ内線に乗り換えないと到達できない駅ペアを使う:
    // 上野は山手線のみ、大手町は丸ノ内線のみなので乗換1回が最小。
    const ueno = stationOnLine(network, '山手線', '上野');
    const otemachi = stationOnLine(network, '丸ノ内線', '大手町');
    const rng = rngTargeting(allStations, ueno, otemachi);

    const q = generateQuestion(network, allStations, { rng });
    expect(q).not.toBeNull();
    expect(q!.origin).toBe(ueno);
    expect(q!.destination).toBe(otemachi);
    expect(q!.minTransfers).toBe(1);
  });

  it('同一グループの駅ペアは返さない（東京の山手線/丸ノ内線レコードを狙っても再抽選される）', () => {
    const tokyoYamanote = stationOnLine(network, '山手線', '東京');
    const tokyoMarunouchi = stationOnLine(network, '丸ノ内線', '東京');
    // 最初に同一グループの東京(山手線)/東京(丸ノ内線)を引かせ、以降は上野/大手町を引かせて
    // 「同一グループはスキップされ、次の候補で成立する」ことを確認する。
    const ueno = stationOnLine(network, '山手線', '上野');
    const otemachi = stationOnLine(network, '丸ノ内線', '大手町');
    const len = allStations.length;

    const tokyoYamanotePos = allStations.indexOf(tokyoYamanote);
    const tokyoMarunouchiPos = allStations.indexOf(tokyoMarunouchi);
    const tokyoYamanoteR = (tokyoYamanotePos + 0.001) / len;
    const tokyoMarunouchiBase =
      tokyoMarunouchiPos > tokyoYamanotePos ? tokyoMarunouchiPos - 1 : tokyoMarunouchiPos;
    const tokyoMarunouchiR = (tokyoMarunouchiBase + 0.001) / (len - 1);

    const uenoPos = allStations.indexOf(ueno);
    const otemachiPos = allStations.indexOf(otemachi);
    const uenoR = (uenoPos + 0.001) / len;
    const otemachiBase = otemachiPos > uenoPos ? otemachiPos - 1 : otemachiPos;
    const otemachiR = (otemachiBase + 0.001) / (len - 1);

    const rng = makeSeededRng([tokyoYamanoteR, tokyoMarunouchiR, uenoR, otemachiR]);
    const q = generateQuestion(network, allStations, { rng });

    expect(q).not.toBeNull();
    expect(network.stations[q!.origin].group).not.toBe(network.stations[q!.destination].group);
    expect(q!.origin).toBe(ueno);
    expect(q!.destination).toBe(otemachi);
  });

  it('デフォルトでは minTransfers>=1 の問題のみ返す', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      const x = Math.sin(calls * 999.123) * 10000;
      return x - Math.floor(x);
    };

    for (let trial = 0; trial < 20; trial++) {
      const q = generateQuestion(network, allStations, { rng });
      if (q) {
        expect(q.minTransfers).toBeGreaterThanOrEqual(1);
        expect(network.stations[q.origin].group).not.toBe(network.stations[q.destination].group);
      }
    }
  });

  it('全駅ペアが直通のみの部分集合を渡すと null を返す（山手線内のみ）', () => {
    // 山手線内の駅のみはすべて同一路線で直通可能（乗換0）。
    // minTransfers>=1 をデフォルトのまま要求すると、どのペアも条件を満たせず null になるはず。
    const yamanoteOnly = [
      stationOnLine(network, '山手線', '東京'),
      stationOnLine(network, '山手線', '神田'),
      stationOnLine(network, '山手線', '秋葉原'),
      stationOnLine(network, '山手線', '上野'),
      stationOnLine(network, '山手線', '池袋'),
    ];
    const rng = makeSeededRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05]);
    const q = generateQuestion(network, yamanoteOnly, { rng });
    expect(q).toBeNull();
  });

  it('areaStations が2駅未満なら null を返す', () => {
    const onlyOne = [stationOnLine(network, '山手線', '東京')];
    const q = generateQuestion(network, onlyOne, {});
    expect(q).toBeNull();
  });

  it('maxTransfers を指定すると、それを超える問題は生成されない', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      const x = Math.sin(calls * 12.345) * 10000;
      return x - Math.floor(x);
    };
    for (let trial = 0; trial < 20; trial++) {
      const q = generateQuestion(network, allStations, { rng, maxTransfers: 1 });
      if (q) {
        expect(q.minTransfers).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rng が省略された場合は Math.random が使われ、問題が生成できる', () => {
    const q = generateQuestion(network, allStations);
    expect(q).not.toBeNull();
    expect(q!.minTransfers).toBeGreaterThanOrEqual(1);
  });

  it('到達不能ペア: テスト電鉄本線は他路線と接続していないため孤立集合として扱われる場合はnull', () => {
    // テスト電鉄本線の駅のみを areaStations にすると、本村は分岐のハブだが全て同一路線で
    // 直通可能（乗換0）になるため、minTransfers>=1を満たせずnullになる。
    const testTetsuOnly = [
      stationOnLine(network, 'テスト電鉄本線', '新宿'),
      stationOnLine(network, 'テスト電鉄本線', '初台'),
      stationOnLine(network, 'テスト電鉄本線', '本村'),
      stationOnLine(network, 'テスト電鉄本線', '東山'),
      stationOnLine(network, 'テスト電鉄本線', '西丘'),
    ];
    const rng = makeSeededRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05]);
    const q = generateQuestion(network, testTetsuOnly, { rng });
    expect(q).toBeNull();
  });
});
