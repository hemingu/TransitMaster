import type { Network } from './types.ts';
import { getNetworkIndex } from './networkIndex.ts';

export interface Question {
  origin: number;
  destination: number;
  minTransfers: number;
}

export interface QuestionOptions {
  minTransfers?: number;
  maxTransfers?: number;
  rng?: () => number;
}

const MAX_ATTEMPTS = 200;

/**
 * 出発駅グループから到着駅グループまでの最小乗換回数を、パターン（有向）単位のラウンド探索で求める。
 * ラウンドk = 乗車k回目。出発グループの駅から乗れるパターン（乗車位置以降の停車駅が到達範囲）を
 * 乗り、到達したグループから次のラウンドで別のパターンに乗る。到着グループに着いたラウンド - 1 が乗換回数。
 * 直通運転（同一パターンで路線をまたぐ）は乗換に数えないため、searchRoute の 'transfers' モードの
 * 乗換回数と一致する。到達不可能な場合は null。
 */
function minTransfersBetweenGroups(
  network: Network,
  originGroup: number,
  destGroup: number
): number | null {
  if (originGroup === destGroup) return 0;

  const index = getNetworkIndex(network);
  const P = network.patterns.length;
  // パターンごとに「これまでに乗車した最小の位置」を覚え、より手前から乗れる場合だけ再走査する
  const boardedFrom = new Int32Array(P).fill(0x7fffffff);
  const reached = new Set<number>([originGroup]);
  let frontier: number[] = [originGroup];

  for (let round = 1; frontier.length > 0; round++) {
    const toScan = new Map<number, number>(); // pattern -> 最小の乗車位置
    for (const g of frontier) {
      for (const s of index.groupMembers.get(g) ?? []) {
        for (let k = index.stationNodeStart[s]; k < index.stationNodeStart[s + 1]; k++) {
          const node = index.stationNodeList[k];
          const p = index.nodePattern[node];
          const pos = index.nodePos[node];
          if (pos < boardedFrom[p] && pos < (toScan.get(p) ?? Number.POSITIVE_INFINITY)) {
            toScan.set(p, pos);
          }
        }
      }
    }
    const next: number[] = [];
    for (const [p, pos] of toScan) {
      boardedFrom[p] = pos;
      const start = index.patOffset[p];
      const end = index.patOffset[p + 1];
      // 環状パターンは全停車駅に到達でき、それ以外は乗車位置より後ろの停車駅に到達できる
      const from = index.isRing[p] ? start : start + pos;
      for (let node = from; node < end; node++) {
        const g = network.stations[index.nodeStation[node]].group;
        if (!reached.has(g)) {
          reached.add(g);
          next.push(g);
        }
      }
    }
    if (reached.has(destGroup)) return round - 1;
    frontier = next;
  }
  return null;
}

/**
 * エリア内の駅集合から、指定条件を満たす2駅を選び出題を生成する。
 * 同一乗換グループの駅同士は不可。最小乗換回数は路線グラフのBFSで求める。
 * 条件（デフォルト: minTransfers>=1）を満たす組み合わせが見つからなければ null。
 */
export function generateQuestion(
  network: Network,
  areaStations: number[],
  opts: QuestionOptions = {}
): Question | null {
  const minTransfers = opts.minTransfers ?? 1;
  const maxTransfers = opts.maxTransfers;
  const rng = opts.rng ?? Math.random;

  // 出題除外（noQuestion）の乗換グループの駅は出発駅・到着駅にしない
  areaStations = areaStations.filter((s) => !network.stations[s].noQuestion);
  if (areaStations.length < 2) return null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const originIdx = Math.floor(rng() * areaStations.length);
    let destIdx = Math.floor(rng() * (areaStations.length - 1));
    if (destIdx >= originIdx) destIdx++;

    const origin = areaStations[originIdx];
    const destination = areaStations[destIdx];

    const originGroup = network.stations[origin].group;
    const destGroup = network.stations[destination].group;
    if (originGroup === destGroup) continue;

    const result = minTransfersBetweenGroups(network, originGroup, destGroup);
    if (result === null) continue;
    if (result < minTransfers) continue;
    if (maxTransfers !== undefined && result > maxTransfers) continue;

    return { origin, destination, minTransfers: result };
  }

  return null;
}
