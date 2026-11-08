import type { Network } from './types.ts';

/** 駅の規模（乗降客数）の絞り込み段階。 */
export type StationScale = 'major' | 'medium' | 'all';

export const STATION_SCALE_LABELS: Record<StationScale, string> = {
  major: '主要駅のみ',
  medium: '中規模駅まで',
  all: '全駅',
};

/** 主要駅のみ = エリア内の出題候補グループのうち乗降客数が上位この割合のもの。 */
export const MAJOR_STATION_TOP_FRACTION = 0.2;
/** 中規模駅まで = 同、上位この割合のもの。 */
export const MEDIUM_STATION_TOP_FRACTION = 0.6;

/** 各段階で対象にする、乗降客数上位の割合（1 = 全グループ）。 */
export const STATION_SCALE_TOP_FRACTION: Record<StationScale, number> = {
  major: MAJOR_STATION_TOP_FRACTION,
  medium: MEDIUM_STATION_TOP_FRACTION,
  all: 1,
};

/** 乗降客数データ（Station.ridership）が1件でもあるか。無ければ駅の規模の絞り込みは「全駅」と同じ扱いになる。 */
export function hasRidershipData(network: Network): boolean {
  return network.stations.some((s) => s.ridership !== undefined);
}

/** 乗換グループごとの乗降客数（同グループの駅レコードの合計。データなしのグループは含めない）。 */
export function groupRidership(network: Network): Map<number, number> {
  const result = new Map<number, number>();
  for (const s of network.stations) {
    if (s.ridership !== undefined) result.set(s.group, (result.get(s.group) ?? 0) + s.ridership);
  }
  return result;
}

/**
 * エリア内の駅から、駅の規模の条件を満たす出題候補の駅（index）を返す。
 * - noQuestion の駅は除く（出題では使わないため、順位付けの母集団にも含めない）。
 * - 乗換グループ単位の乗降客数で降順に並べ、上位 ceil(グループ数 × 割合) 件のグループを残す
 *   （境界で同数のグループは全て残す。データなし＝0 のグループは「全駅」でのみ残る）。
 * - 乗降客数データがネットワーク内に1件も無い場合は条件を無視する（「全駅」と同じ）。
 */
export function filterStationsByScale(
  network: Network,
  areaStations: number[],
  scale: StationScale
): number[] {
  const candidates = areaStations.filter((s) => !network.stations[s].noQuestion);
  const fraction = STATION_SCALE_TOP_FRACTION[scale];
  if (fraction >= 1 || !hasRidershipData(network)) return candidates;

  const ridership = groupRidership(network);
  const groups = [...new Set(candidates.map((s) => network.stations[s].group))];
  if (groups.length === 0) return [];
  const values = groups.map((g) => ridership.get(g) ?? 0).sort((a, b) => b - a);
  const keep = Math.max(1, Math.ceil(groups.length * fraction));
  const cutoff = values[Math.min(keep, values.length) - 1];
  const selected = new Set(
    groups.filter((g) => {
      const v = ridership.get(g) ?? 0;
      return v > 0 && v >= cutoff;
    })
  );
  return candidates.filter((s) => selected.has(network.stations[s].group));
}

/**
 * エリア内の駅から、乗降客数上位 topN 件の乗換グループに属する出題候補の駅（index）を返す。
 * - noQuestion の駅は除く（順位付けの母集団にも含めない）。
 * - 境界（topN 番目）と同数のグループは全て残す。乗降客数 0（データなし）のグループは topN 指定時は残さない。
 * - topN が null の場合は絞り込まず、noQuestion 以外の全駅を返す。
 */
export function filterStationsByTopGroups(
  network: Network,
  areaStations: number[],
  topN: number | null
): number[] {
  const candidates = areaStations.filter((s) => !network.stations[s].noQuestion);
  if (topN === null) return candidates;
  if (topN <= 0) return [];

  const ridership = groupRidership(network);
  const groups = [...new Set(candidates.map((s) => network.stations[s].group))];
  const values = groups.map((g) => ridership.get(g) ?? 0).sort((a, b) => b - a);
  if (values.length === 0) return [];
  const cutoff = values[Math.min(topN, values.length) - 1];
  const selected = new Set(
    groups.filter((g) => {
      const v = ridership.get(g) ?? 0;
      return v > 0 && v >= cutoff;
    })
  );
  return candidates.filter((s) => selected.has(network.stations[s].group));
}
