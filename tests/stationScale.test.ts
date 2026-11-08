import { describe, expect, it } from 'vitest';
import { generateQuestion } from '../src/lib/question.ts';
import {
  STATION_SCALE_TOP_FRACTION,
  filterStationsByScale,
  filterStationsByTopGroups,
  groupRidership,
  hasRidershipData,
} from '../src/lib/stationScale.ts';
import type { Network, Station } from '../src/lib/types.ts';

/** 10グループ（各1駅）。g0..g9 に乗降客数 1000,900,...,100。noQuestion の g10（最大値）と、データなしの g11 もある。 */
function scaleNetwork(withData = true): Network {
  const stations: Station[] = [];
  for (let g = 0; g < 10; g++) {
    stations.push({ name: `駅${g}`, en: '', lat: 35, lon: 139, group: g, line: 0, ...(withData ? { ridership: 1000 - g * 100 } : {}) });
  }
  stations.push({ name: 'X', en: '', lat: 35, lon: 139, group: 10, line: 0, noQuestion: true, ...(withData ? { ridership: 99999 } : {}) });
  stations.push({ name: 'Y', en: '', lat: 35, lon: 139, group: 11, line: 0 });
  // 全駅が1つのパターンで結ばれる（乗換0回）
  const idx = stations.map((_, i) => i);
  const segs = idx.length - 1;
  return {
    formatVersion: 3,
    stations,
    lines: [{ name: 'L', en: 'L', company: 'C', color: null }],
    patterns: [{ stops: idx, segSec: new Array(segs).fill(60), segLine: new Array(segs).fill(0) }],
    transferSec: 0,
  };
}

describe('filterStationsByScale', () => {
  const net = scaleNetwork();
  const all = net.stations.map((_, i) => i);
  const groups = (idxs: number[]) => idxs.map((i) => net.stations[i].group);

  it('割合の定数は 主要=20%、中規模=60%、全駅=100%', () => {
    expect(STATION_SCALE_TOP_FRACTION).toEqual({ major: 0.2, medium: 0.6, all: 1 });
  });

  it('全駅は noQuestion を除く全候補（データなしグループも含む）', () => {
    expect(groups(filterStationsByScale(net, all, 'all'))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
  });

  it('主要駅のみ = 候補11グループの上位20%（ceil で3件）。noQuestion は母集団に含めない', () => {
    expect(groups(filterStationsByScale(net, all, 'major'))).toEqual([0, 1, 2]);
  });

  it('中規模駅まで = 上位60%（ceil(6.6)=7件）。データなし（0扱い）は含まれない', () => {
    expect(groups(filterStationsByScale(net, all, 'medium'))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('エリアごとに母集団が変わる（エリア内の相対順位）', () => {
    const area = [5, 6, 7, 8, 9, 11]; // 6グループ → 上位20% = ceil(1.2) = 2件
    expect(groups(filterStationsByScale(net, area, 'major'))).toEqual([5, 6]);
  });

  it('境界の同値グループはすべて残す', () => {
    const n = scaleNetwork();
    n.stations[1].ridership = 1000; // g0 と g1 が同値
    n.stations[2].ridership = 1000;
    n.stations[3].ridership = 1000;
    const a = n.stations.map((_, i) => i);
    expect(filterStationsByScale(n, a, 'major').map((i) => n.stations[i].group)).toEqual([0, 1, 2, 3]);
  });

  it('同じグループの複数レコードは合計して順位付けする', () => {
    const n = scaleNetwork();
    n.stations.push({ name: '駅9別線', en: '', lat: 35, lon: 139, group: 9, line: 0, ridership: 5000 });
    expect(groupRidership(n).get(9)).toBe(5100);
    const a = n.stations.map((_, i) => i);
    const major = filterStationsByScale(n, a, 'major').map((i) => n.stations[i].group);
    expect(major).toContain(9);
    expect(major).toHaveLength(4); // g9(2レコード目含む)・g0・g1・g9本体
  });

  it('乗降客数データが全く無いネットワークでは条件を無視する（全駅と同じ）', () => {
    const n = scaleNetwork(false);
    expect(hasRidershipData(n)).toBe(false);
    const a = n.stations.map((_, i) => i);
    expect(filterStationsByScale(n, a, 'major')).toEqual(filterStationsByScale(n, a, 'all'));
  });
});

describe('駅の規模による出題', () => {
  const net = scaleNetwork();
  const all = net.stations.map((_, i) => i);

  it('出発駅・到着駅の両方が条件を満たす駅から選ばれる', () => {
    const candidates = filterStationsByScale(net, all, 'major');
    for (let i = 0; i < 20; i++) {
      const q = generateQuestion(net, candidates, { minTransfers: 0 });
      expect(q).not.toBeNull();
      expect(candidates).toContain(q!.origin);
      expect(candidates).toContain(q!.destination);
    }
  });

  it('条件を満たす組合せが無ければ null（乗換1回以上は全て0回のため出題不可）', () => {
    const candidates = filterStationsByScale(net, all, 'major');
    expect(generateQuestion(net, candidates, { minTransfers: 1 })).toBeNull();
  });
});

describe('filterStationsByTopGroups', () => {
  const net = scaleNetwork();
  const all = net.stations.map((_, i) => i);
  const groups = (n: Network, idxs: number[]) => idxs.map((i) => n.stations[i].group);

  it('上位N件のグループ（noQuestion は母集団外）', () => {
    expect(groups(net, filterStationsByTopGroups(net, all, 3))).toEqual([0, 1, 2]);
  });

  it('N がグループ数以上でも、乗降客数 0 のグループは含めない', () => {
    expect(groups(net, filterStationsByTopGroups(net, all, 100))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('null は noQuestion 以外の全駅（乗降客数なしも含む）', () => {
    expect(groups(net, filterStationsByTopGroups(net, all, null))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
  });

  it('境界の同値グループはすべて残す', () => {
    const n = scaleNetwork();
    n.stations[1].ridership = 1000;
    n.stations[2].ridership = 1000;
    n.stations[3].ridership = 1000;
    const a = n.stations.map((_, i) => i);
    expect(groups(n, filterStationsByTopGroups(n, a, 2))).toEqual([0, 1, 2, 3]);
  });

  it('同じグループの複数レコードは合計して順位付けし、レコードは全て残る', () => {
    const n = scaleNetwork();
    n.stations.push({ name: '駅9別線', en: '', lat: 35, lon: 139, group: 9, line: 0, ridership: 5000 });
    const a = n.stations.map((_, i) => i);
    const r = groups(n, filterStationsByTopGroups(n, a, 1));
    expect(r.sort()).toEqual([9, 9]);
  });
});
