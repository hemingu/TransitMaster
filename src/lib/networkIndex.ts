import type { Network } from './types.ts';

/** 駅がどの (路線, パターン, パターン内位置) に停車するかを表す逆引きエントリ。 */
export interface StationPatternRef {
  /** 路線index。 */
  line: number;
  /** パターンindex。 */
  pattern: number;
  /** パターン内での停車位置（stops配列のindex）。 */
  pos: number;
}

/**
 * Network から導出される高速検索用インデックス。Network 自体は不変データなので
 * WeakMap でメモ化し、同一参照に対する再計算を避ける。
 */
export interface NetworkIndex {
  /** グループID -> そのグループに属する駅index一覧。 */
  groupMembers: Map<number, number[]>;
  /** 駅index -> その駅が登場する (路線, パターン, 位置) の一覧（逆引き）。 */
  stationPatterns: StationPatternRef[][];
  /**
   * cumSec[line][pattern][i] = そのパターンの stops[0] から stops[i] までの累積所要秒。
   * cumSec[line][pattern][0] === 0、配列長は stops.length（= segSec.length + 1）。
   */
  cumSec: number[][][];
  /** 路線index -> その路線が停車する駅グループの集合。 */
  lineGroups: Set<number>[];
  /**
   * isRing[line][pattern] = そのパターンが環状か（stops[0] === stops[stops.length-1] かつ stops.length >= 4）。
   * stops.length >= 4 という条件は「始点 - 中間駅1つ以上 - 始点」を要求し、
   * 折り返しのみの2駅パターン（stops.length===2かつ同一駅、通常は発生しないが念のため）を誤検出しないための下限。
   */
  isRing: boolean[][];
}

const cache = new WeakMap<Network, NetworkIndex>();

/**
 * Network から NetworkIndex を構築（または WeakMap キャッシュから取得）する。
 *
 * 環状パターンの扱い: stops の末尾に始点駅が再掲されている場合、stationPatterns への逆引き登録は
 * 先頭位置（pos=0）のみを行い、末尾位置（pos=stops.length-1）は登録しない。
 * これにより、環状パターンの始点駅が同一パターンに対して二重登録されることを防ぐ。
 */
export function getNetworkIndex(network: Network): NetworkIndex {
  const cached = cache.get(network);
  if (cached) {
    return cached;
  }

  const n = network.stations.length;

  // ---- groupMembers ----
  const groupMembers = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const g = network.stations[i].group;
    const arr = groupMembers.get(g);
    if (arr) {
      arr.push(i);
    } else {
      groupMembers.set(g, [i]);
    }
  }

  // ---- stationPatterns, cumSec, lineGroups, isRing ----
  const stationPatterns: StationPatternRef[][] = Array.from({ length: n }, () => []);
  const cumSec: number[][][] = [];
  const lineGroups: Set<number>[] = [];
  const isRing: boolean[][] = [];

  for (let lineIdx = 0; lineIdx < network.lines.length; lineIdx++) {
    const line = network.lines[lineIdx];
    const lineCumSec: number[][] = [];
    const lineIsRing: boolean[] = [];
    const groupsForLine = new Set<number>();

    for (let patternIdx = 0; patternIdx < line.patterns.length; patternIdx++) {
      const pattern = line.patterns[patternIdx];
      const { stops, segSec } = pattern;

      // 累積秒の計算
      const cum: number[] = new Array(stops.length);
      cum[0] = 0;
      for (let i = 0; i < segSec.length; i++) {
        cum[i + 1] = cum[i] + segSec[i];
      }
      lineCumSec.push(cum);

      // 環状判定
      const ring =
        stops.length >= 4 && stops[0] === stops[stops.length - 1];
      lineIsRing.push(ring);

      // 逆引き登録（環状パターンは末尾の再掲位置を登録しない）
      const lastPos = stops.length - 1;
      for (let pos = 0; pos < stops.length; pos++) {
        if (ring && pos === lastPos) {
          continue;
        }
        const stationIdx = stops[pos];
        stationPatterns[stationIdx].push({ line: lineIdx, pattern: patternIdx, pos });
        groupsForLine.add(network.stations[stationIdx].group);
      }
    }

    cumSec.push(lineCumSec);
    isRing.push(lineIsRing);
    lineGroups.push(groupsForLine);
  }

  const index: NetworkIndex = {
    groupMembers,
    stationPatterns,
    cumSec,
    lineGroups,
    isRing,
  };

  cache.set(network, index);
  return index;
}
