import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../scripts/buildNetwork.ts';
import { searchRoute } from '../src/lib/raptor.ts';
import { miniGtfsFeeds } from './fixtures/miniGtfs.ts';
import type { Network } from '../src/lib/types.ts';

function findStation(network: Network, name: string, feed: string): number {
  const idx = network.stations.findIndex((s) => s.name === name && s.feed === feed);
  if (idx === -1) throw new Error(`station not found: ${name} (${feed})`);
  return idx;
}

const { network } = buildNetwork(miniGtfsFeeds());

const TOKYO_JR = findStation(network, '東京', 'jr');
const TOKYO_METRO = findStation(network, '東京', 'metro');
const SHINJUKU_JR = findStation(network, '新宿', 'jr');
const UENO_JR = findStation(network, '上野', 'jr');

// フィクスチャのダイヤは10分間隔グリッドのため、丁度9:00:00発だと
// 直通(丸ノ内線 Tokyo->Shinjuku 19分)と乗換ルート(丸ノ内線 Tokyo->Ochanomizu + 中央線 Ochanomizu->Shinjuku)が
// どちらも次発は9:07:00/9:09:00発となり到着が9:26:00で同着してしまう（実測で確認済み）。
// 「乗換ルートの方が先に着く」という意図を明確に検証するため、直通の次発を1本逃す 9:08:00 発を用いる。
// 9:08:00発: 直通は9:07:00発が既に出た後なので次発9:17:00発->9:36:00着。
// 乗換ルートは丸ノ内線9:09:00発(Tokyo)->9:14:00着(Ochanomizu)、乗換180秒後9:20:00発の中央線->9:26:00着(Shinjuku)。
const DEPART_TRANSFER_FASTER = 9 * 3600 + 8 * 60; // 9:08:00

describe('searchRoute (RAPTOR)', () => {
  it('mode=time: 東京->新宿は乗換1回(丸ノ内線->中央線)の経路が直通より早く到着する', () => {
    const itin = searchRoute(network, TOKYO_JR, SHINJUKU_JR, DEPART_TRANSFER_FASTER, 'time');
    expect(itin).not.toBeNull();
    const result = itin!;

    // 乗換1回: 丸ノ内線(Tokyo->Ochanomizu) -> 中央線(Ochanomizu->Shinjuku)
    expect(result.transfers).toBe(1);
    expect(result.legs).toHaveLength(2);
    expect(network.lines[result.legs[0].line].name).toBe('丸ノ内線');
    expect(network.lines[result.legs[1].line].name).toBe('中央線');

    expect(result.arrive).toBe(9 * 3600 + 26 * 60); // 9:26:00

    // 直通(丸ノ内線のみ)の到着時刻より早いことを確認
    const directItin = searchRoute(
      network,
      TOKYO_JR,
      SHINJUKU_JR,
      DEPART_TRANSFER_FASTER,
      'transfers'
    );
    expect(directItin).not.toBeNull();
    expect(directItin!.transfers).toBe(0);
    expect(result.arrive).toBeLessThan(directItin!.arrive);
  });

  it('mode=transfers: 東京->新宿は丸ノ内線直通(乗換0・170円)が返る', () => {
    const itin = searchRoute(network, TOKYO_JR, SHINJUKU_JR, DEPART_TRANSFER_FASTER, 'transfers');
    expect(itin).not.toBeNull();
    const result = itin!;

    expect(result.transfers).toBe(0);
    expect(result.legs).toHaveLength(1);
    expect(network.lines[result.legs[0].line].name).toBe('丸ノ内線');
    expect(result.fare).toBe(170);
    expect(result.arrive).toBe(9 * 3600 + 36 * 60); // 9:36:00 (次発9:17:00 + 19分)
  });

  it('mode=fare: 東京->新宿はfare=170の直通が返る', () => {
    const itin = searchRoute(network, TOKYO_JR, SHINJUKU_JR, DEPART_TRANSFER_FASTER, 'fare');
    expect(itin).not.toBeNull();
    const result = itin!;

    expect(result.fare).toBe(170);
    expect(result.transfers).toBe(0);
    expect(network.lines[result.legs[0].line].name).toBe('丸ノ内線');
  });

  it('到達不能な場合は null を返す（終電後の出発）', () => {
    // フィクスチャの全パターンは10:00始発が最終（終電後の 25:00 = 90000秒発を指定）
    const itin = searchRoute(network, TOKYO_JR, SHINJUKU_JR, 25 * 3600, 'time');
    expect(itin).toBeNull();
  });

  it('到達不能な場合は null を返す（出発と到着が同一グループ）', () => {
    // 東京(jr)と東京(metro)は同一乗換グループ
    const itin = searchRoute(network, TOKYO_JR, TOKYO_METRO, 9 * 3600, 'time');
    expect(itin).toBeNull();
  });

  it('上野->新宿: 乗換を要する経路の legs 連結性を検証する', () => {
    const itin = searchRoute(network, UENO_JR, SHINJUKU_JR, 9 * 3600, 'time');
    expect(itin).not.toBeNull();
    const result = itin!;

    expect(result.legs.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < result.legs.length - 1; i++) {
      const cur = result.legs[i];
      const next = result.legs[i + 1];
      // 前legの到着駅と次legの出発駅は同一乗換グループであること
      expect(network.stations[cur.to].group).toBe(network.stations[next.from].group);
      // 次legの出発時刻は、前legの到着時刻 + 乗換時間 以降であること
      expect(next.dep).toBeGreaterThanOrEqual(cur.arr + network.transferSec);
    }

    // legsの整合性: depart/arriveはlegs先頭・末尾と一致
    expect(result.depart).toBe(result.legs[0].dep);
    expect(result.arrive).toBe(result.legs[result.legs.length - 1].arr);
    expect(result.transfers).toBe(result.legs.length - 1);
  });

  it('出発グループの別フィード駅（丸ノ内線=metro東京）からも乗車できる', () => {
    // 東京(jr)を指定しても、同一グループのmetro東京始発の丸ノ内線に乗車して新宿へ直通できる
    const itin = searchRoute(network, TOKYO_JR, SHINJUKU_JR, DEPART_TRANSFER_FASTER, 'transfers');
    expect(itin).not.toBeNull();
    const result = itin!;

    // 直通1本目のlegは丸ノ内線であり、その乗車駅(from)はmetro東京(TOKYO_METRO)であること
    expect(result.legs[0].line).toBe(
      network.lines.findIndex((l) => l.name === '丸ノ内線')
    );
    expect(result.legs[0].from).toBe(TOKYO_METRO);
    // fromはjr東京ではないが、出発グループが同じであることを確認
    expect(network.stations[result.legs[0].from].group).toBe(network.stations[TOKYO_JR].group);
  });
});
