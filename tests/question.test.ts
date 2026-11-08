import { describe, expect, it } from 'vitest';
import { generateQuestion } from '../src/lib/question.ts';
import { searchRoute } from '../src/lib/raptor.ts';
import { findStation, miniNetwork } from './fixtures/miniMt3d.ts';

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

describe('generateQuestion (miniNetwork)', () => {
  const network = miniNetwork();
  const allStations = network.stations.map((_, i) => i);
  const st = (line: string, name: string) => findStation(network, line, name);

  it('東京→練馬 は最小乗換2回（山手線/中央線 → 大江戸線 → 都庁前で大江戸線の別系統）', () => {
    const tokyo = st('山手線', '東京');
    const nerima = st('大江戸線', '練馬');
    const q = generateQuestion(network, allStations, { rng: rngTargeting(allStations, tokyo, nerima) });
    expect(q).not.toBeNull();
    expect(q!.origin).toBe(tokyo);
    expect(q!.destination).toBe(nerima);
    expect(q!.minTransfers).toBe(2);
  });

  it('上野→横浜 は最小乗換1回（山手線→副都心線から東横線への直通）', () => {
    const ueno = st('山手線', '上野');
    const yokohama = st('東横線', '横浜');
    const q = generateQuestion(network, allStations, { rng: rngTargeting(allStations, ueno, yokohama) });
    expect(q!.minTransfers).toBe(1);
  });

  it('直通運転は乗換に数えない: 池袋→元町・中華街 は乗換0（minTransfers>=1 では出題されない）', () => {
    const ikebukuro = st('副都心線', '池袋');
    const motomachi = st('みなとみらい線', '元町・中華街');
    const pair = [ikebukuro, motomachi];
    const q0 = generateQuestion(network, pair, { minTransfers: 0, rng: makeSeededRng([0.1, 0.9]) });
    expect(q0).not.toBeNull();
    expect(q0!.minTransfers).toBe(0);
    expect(generateQuestion(network, pair, { rng: makeSeededRng([0.1, 0.9, 0.5, 0.2]) })).toBeNull();
  });

  it('同一グループの駅ペアは返さない（東京の山手線/中央線レコード）', () => {
    const pair = [st('山手線', '東京'), st('中央線', '東京')];
    expect(generateQuestion(network, pair, { minTransfers: 0, rng: makeSeededRng([0.1, 0.9, 0.4]) })).toBeNull();
  });

  it('有向: 一方向にしか走らない区間の逆方向（練馬→新宿西口）は到達不能で出題されない', () => {
    const pair = [st('大江戸線', '練馬'), st('大江戸線', '新宿西口')];
    // 練馬→新宿西口 は不可、新宿西口→練馬 は可。出題されるなら向きは新宿西口→練馬
    const q = generateQuestion(network, pair, { minTransfers: 0, rng: makeSeededRng([0.1, 0.9, 0.3, 0.7]) });
    if (q !== null) {
      expect(q.origin).toBe(st('大江戸線', '新宿西口'));
      expect(q.destination).toBe(st('大江戸線', '練馬'));
    }
  });

  it('minTransfers は searchRoute の transfers モードの乗換回数と一致する（全組合せ）', () => {
    let checked = 0;
    for (const a of allStations) {
      for (const b of allStations) {
        if (a === b) continue;
        const q = generateQuestion(network, [a, b], {
          minTransfers: 0,
          rng: makeSeededRng([0.1, 0.9, 0.2, 0.8]),
        });
        // [a, b] の2駅のみ: rng により出発・到着の向きは (a→b) か (b→a) になりうるため、
        // 出題があればその向きでの searchRoute と比較する
        if (q === null) continue;
        const ref = searchRoute(network, q.origin, q.destination, 'transfers');
        expect(ref).not.toBeNull();
        expect(q.minTransfers).toBe(ref!.transfers);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
