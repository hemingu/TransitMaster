import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../scripts/buildNetwork.ts';
import { miniGtfsFeeds } from './fixtures/miniGtfs.ts';
import { generateQuestion } from '../src/lib/question.ts';
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

describe('generateQuestion', () => {
  const { network } = buildNetwork(miniGtfsFeeds());
  const allStations = network.stations.map((_, i) => i);

  function findStationIndex(name: string, feed: string): number {
    const idx = network.stations.findIndex((s) => s.name === name && s.feed === feed);
    if (idx === -1) throw new Error(`station not found: ${name} (${feed})`);
    return idx;
  }

  it('上野→新宿(jr) の問題は minTransfers=1 になる', () => {
    const ueno = findStationIndex('上野', 'jr');
    const shinjukuJr = findStationIndex('新宿', 'jr');
    const rng = rngTargeting(allStations, ueno, shinjukuJr);

    const q = generateQuestion(network, allStations, { rng });
    expect(q).not.toBeNull();
    expect(q!.origin).toBe(ueno);
    expect(q!.destination).toBe(shinjukuJr);
    expect(q!.minTransfers).toBe(1);
  });

  it('同一グループの駅ペアは返さない（東京jr/東京metroを狙っても再抽選される）', () => {
    const tokyoJr = findStationIndex('東京', 'jr');
    const tokyoMetro = findStationIndex('東京', 'metro');
    // 最初に同一グループの東京jr/東京metroを引かせ、以降はUeno/Shinjuku(jr)を引かせて
    // 「同一グループはスキップされ、次の候補で成立する」ことを確認する。
    const ueno = findStationIndex('上野', 'jr');
    const shinjukuJr = findStationIndex('新宿', 'jr');
    const len = allStations.length;
    const tokyoJrPos = allStations.indexOf(tokyoJr);
    const tokyoMetroPos = allStations.indexOf(tokyoMetro);
    const tokyoJrR = (tokyoJrPos + 0.001) / len;
    const tokyoMetroBase = tokyoMetroPos > tokyoJrPos ? tokyoMetroPos - 1 : tokyoMetroPos;
    const tokyoMetroR = (tokyoMetroBase + 0.001) / (len - 1);

    const uenoPos = allStations.indexOf(ueno);
    const shinjukuPos = allStations.indexOf(shinjukuJr);
    const uenoR = (uenoPos + 0.001) / len;
    const shinjukuBase = shinjukuPos > uenoPos ? shinjukuPos - 1 : shinjukuPos;
    const shinjukuR = (shinjukuBase + 0.001) / (len - 1);

    const rng = makeSeededRng([tokyoJrR, tokyoMetroR, uenoR, shinjukuR]);
    const q = generateQuestion(network, allStations, { rng });

    expect(q).not.toBeNull();
    expect(network.stations[q!.origin].group).not.toBe(network.stations[q!.destination].group);
    // 同一グループはスキップされ、Ueno/Shinjuku(jr) の組み合わせに落ち着くはず
    expect(q!.origin).toBe(ueno);
    expect(q!.destination).toBe(shinjukuJr);
  });

  it('デフォルトでは minTransfers>=1 の問題のみ返す', () => {
    // Math.random 相当のランダムなrngで多数回試行し、常にminTransfers>=1であることを確認
    let calls = 0;
    const rng = () => {
      calls++;
      // 疑似ランダム風の値を生成（0以上1未満）
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

  it('全駅ペアが直通のみの部分集合を渡すと null を返す', () => {
    // 山手線内の駅のみ（東京jr・神田・秋葉原・上野・池袋jr）はすべて同一路線で直通可能（乗換0）。
    // minTransfers>=1 をデフォルトのまま要求すると、どのペアも条件を満たせず null になるはず。
    const yamanoteOnly = [
      findStationIndex('東京', 'jr'),
      findStationIndex('神田', 'jr'),
      findStationIndex('秋葉原', 'jr'),
      findStationIndex('上野', 'jr'),
      findStationIndex('池袋', 'jr'),
    ];
    const rng = makeSeededRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05]);
    const q = generateQuestion(network, yamanoteOnly, { rng });
    expect(q).toBeNull();
  });

  it('areaStations が2駅未満なら null を返す', () => {
    const onlyOne = [findStationIndex('東京', 'jr')];
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
});
