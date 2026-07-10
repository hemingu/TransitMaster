import type { Network, RouteEvaluation, RouteLeg } from './types.ts';

export type InvalidReason =
  | 'empty'
  | 'wrong-origin'
  | 'wrong-destination'
  | 'station-not-on-line'
  | 'not-connected-on-line'
  | 'bad-transfer'
  | 'degenerate-leg';

export interface ValidationResult {
  valid: boolean;
  reason?: InvalidReason;
  legIndex?: number;
}

/** 駅indexの group を取得する（範囲外なら -1 で誰とも一致しない値を返す） */
function groupOf(network: Network, stationIdx: number): number {
  const station = network.stations[stationIdx];
  return station ? station.group : -1;
}

/**
 * 指定した路線上で from から to へ、いずれかの Pattern の隣接停車駅（無向）を
 * たどって到達できるかを判定する。
 *
 * まず from/to が路線のいずれかの Pattern.stops に含まれているかを確認し、
 * 含まれていなければ 'station-not-on-line' を返す。
 * 両方含まれているが、隣接グラフ上で連結でなければ 'not-connected-on-line' を返す。
 * 連結なら undefined（問題なし）を返す。
 */
function checkLegOnLine(
  network: Network,
  lineIdx: number,
  from: number,
  to: number,
): 'station-not-on-line' | 'not-connected-on-line' | undefined {
  const line = network.lines[lineIdx];
  if (!line) return 'station-not-on-line';

  let fromSeen = false;
  let toSeen = false;
  // 隣接リスト（無向）を全 Pattern から構築
  const adjacency = new Map<number, Set<number>>();
  const addEdge = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const pattern of line.patterns) {
    for (let i = 0; i < pattern.stops.length; i++) {
      const stop = pattern.stops[i];
      if (stop === from) fromSeen = true;
      if (stop === to) toSeen = true;
      if (i > 0) {
        addEdge(pattern.stops[i - 1], pattern.stops[i]);
      }
    }
  }

  if (!fromSeen || !toSeen) return 'station-not-on-line';

  // BFS で from -> to の連結性を判定
  const visited = new Set<number>([from]);
  const queue: number[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) return undefined;
    for (const next of adjacency.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited.has(to) ? undefined : 'not-connected-on-line';
}

export function validateRoute(
  network: Network,
  origin: number,
  destination: number,
  legs: RouteLeg[],
): ValidationResult {
  if (legs.length === 0) {
    return { valid: false, reason: 'empty' };
  }

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.from === leg.to) {
      return { valid: false, reason: 'degenerate-leg', legIndex: i };
    }
    const lineCheck = checkLegOnLine(network, leg.line, leg.from, leg.to);
    if (lineCheck) {
      return { valid: false, reason: lineCheck, legIndex: i };
    }
  }

  const originGroup = groupOf(network, origin);
  const destinationGroup = groupOf(network, destination);

  const firstLeg = legs[0];
  if (groupOf(network, firstLeg.from) !== originGroup) {
    return { valid: false, reason: 'wrong-origin', legIndex: 0 };
  }

  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1];
    const cur = legs[i];
    if (groupOf(network, prev.to) !== groupOf(network, cur.from)) {
      return { valid: false, reason: 'bad-transfer', legIndex: i };
    }
  }

  const lastLeg = legs[legs.length - 1];
  if (groupOf(network, lastLeg.to) !== destinationGroup) {
    return { valid: false, reason: 'wrong-destination', legIndex: legs.length - 1 };
  }

  return { valid: true };
}

/**
 * 指定路線の全 Pattern を合成した無向グラフ（ノード=駅index、辺重み=区間所要秒）上で、
 * from から to への最短所要秒を Dijkstra 法で求める。
 *
 * 分岐路線（Y字など）はパターンごとに部分的な停車列しか持たないため、単一パターンの
 * stops.indexOf だけでは分岐をまたぐ leg（例: 東山→西丘が別パターンの組み合わせでしか
 * 表現できない場合）を正しく評価できない。全パターンの隣接区間を1つの無向グラフに
 * 合成することで、validateRoute が許容する経路（隣接性さえ繋がっていれば良い）を
 * 漏れなく評価できるようにする。
 *
 * 到達不能なら null を返す。
 */
function shortestRideSecOnLine(
  network: Network,
  lineIdx: number,
  from: number,
  to: number,
): number | null {
  if (from === to) return 0;
  const line = network.lines[lineIdx];
  if (!line) return null;

  // 隣接リスト（無向、重み=segSec）を全 Pattern から構築
  const adjacency = new Map<number, Map<number, number>>();
  const addEdge = (a: number, b: number, w: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    if (!adjacency.has(b)) adjacency.set(b, new Map());
    const mapA = adjacency.get(a)!;
    const mapB = adjacency.get(b)!;
    if (!mapA.has(b) || mapA.get(b)! > w) mapA.set(b, w);
    if (!mapB.has(a) || mapB.get(a)! > w) mapB.set(a, w);
  };

  for (const pattern of line.patterns) {
    for (let i = 0; i < pattern.segSec.length; i++) {
      addEdge(pattern.stops[i], pattern.stops[i + 1], pattern.segSec[i]);
    }
  }

  if (!adjacency.has(from) || !adjacency.has(to)) return null;

  // Dijkstra法（駅数は小規模なので単純な優先度なし線形探索で十分）
  const dist = new Map<number, number>([[from, 0]]);
  const visited = new Set<number>();

  for (;;) {
    let cur: number | null = null;
    let curDist = Number.POSITIVE_INFINITY;
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < curDist) {
        curDist = d;
        cur = node;
      }
    }
    if (cur === null) break;
    if (cur === to) return curDist;
    visited.add(cur);

    for (const [next, weight] of adjacency.get(cur) ?? []) {
      if (visited.has(next)) continue;
      const candidate = curDist + weight;
      if (!dist.has(next) || candidate < dist.get(next)!) {
        dist.set(next, candidate);
      }
    }
  }

  return dist.has(to) ? (dist.get(to) as number) : null;
}

/**
 * 確定した legs（validateRouteで有効と判定された経路）を評価し、乗車時間・乗換回数・
 * 総所要秒（乗換ペナルティ込み）を返す。
 *
 * 各 leg は、その路線の全 Pattern を合成した無向グラフ上での from->to 最短所要秒として
 * 評価する（分岐路線でパターンをまたぐ leg も正しく評価できる）。
 * いずれかの leg が到達不能であれば totalSec は null（防御的。validateRoute を通った経路は
 * 通常ここで null にはならない）。
 */
export function evaluateRoute(network: Network, legs: RouteLeg[]): RouteEvaluation {
  const transfers = legs.length - 1;

  let rideSec = 0;
  let broken = false;

  for (const leg of legs) {
    const sec = shortestRideSecOnLine(network, leg.line, leg.from, leg.to);
    if (sec === null) {
      broken = true;
      break;
    }
    rideSec += sec;
  }

  const totalSec = broken ? null : rideSec + transfers * network.transferSec;

  return { transfers, rideSec, totalSec };
}
