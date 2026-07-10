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
 * 路線グラフ上で、出発駅グループから到着駅グループまでの最小乗換回数を求める。
 * ノード=路線。2路線が同一乗換グループの駅を共有すれば辺で接続。
 * 出発駅グループが乗れる路線集合から到着駅グループへ到達するまでの最小路線数-1が乗換回数。
 * 到達不可能な場合は null。
 */
function minTransfersBetweenGroups(
  network: Network,
  originGroup: number,
  destGroup: number
): number | null {
  if (originGroup === destGroup) return 0;

  // 各路線が停車する乗換グループの集合（NetworkIndexでキャッシュ済みのものを利用し、
  // 出題リトライのたびに全路線を線形走査する再計算を避ける）
  const lineGroups = getNetworkIndex(network).lineGroups;

  const originLines: number[] = [];
  const destLines: number[] = [];
  lineGroups.forEach((groups, lineIdx) => {
    if (groups.has(originGroup)) originLines.push(lineIdx);
    if (groups.has(destGroup)) destLines.push(lineIdx);
  });

  if (originLines.length === 0 || destLines.length === 0) return null;

  const destLineSet = new Set(destLines);

  // 出発駅グループに乗り入れる路線から即座に到着可能か（乗換0）
  for (const lineIdx of originLines) {
    if (destLineSet.has(lineIdx)) return 0;
  }

  // 路線ノードのBFS。distance[line] = その路線に乗るまでに要した乗換回数
  const visited = new Set<number>(originLines);
  let frontier = originLines;
  let transfers = 0;

  while (frontier.length > 0) {
    transfers++;
    const nextFrontier: number[] = [];
    // frontier の各路線が経由する全乗換グループに接続する路線を集める
    const reachableGroups = new Set<number>();
    for (const lineIdx of frontier) {
      for (const g of lineGroups[lineIdx]) {
        reachableGroups.add(g);
      }
    }
    for (let lineIdx = 0; lineIdx < network.lines.length; lineIdx++) {
      if (visited.has(lineIdx)) continue;
      const groups = lineGroups[lineIdx];
      let connects = false;
      for (const g of reachableGroups) {
        if (groups.has(g)) {
          connects = true;
          break;
        }
      }
      if (!connects) continue;
      visited.add(lineIdx);
      if (groups.has(destGroup)) {
        return transfers;
      }
      nextFrontier.push(lineIdx);
    }
    frontier = nextFrontier;
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
