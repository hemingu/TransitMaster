import type { Network, RouteLeg } from './types.ts';

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

export interface RouteEvaluation {
  transfers: number;
  fare: number | null;
  durationSec: number | null;
  arriveSec: number | null;
}

/**
 * 指定路線・区間 (from -> to、この順) を含む Pattern のうち、
 * from 発車時刻が earliestDepartSec 以降で最も早い trip を探す。
 * 見つかれば { depSec, arrSec } を返し、無ければ undefined。
 */
function findEarliestTrip(
  network: Network,
  lineIdx: number,
  from: number,
  to: number,
  earliestDepartSec: number,
): { depSec: number; arrSec: number } | undefined {
  const line = network.lines[lineIdx];
  if (!line) return undefined;

  let best: { depSec: number; arrSec: number } | undefined;

  for (const pattern of line.patterns) {
    const fromIdx = pattern.stops.indexOf(from);
    if (fromIdx === -1) continue;
    const toIdx = pattern.stops.indexOf(to, fromIdx + 1);
    if (toIdx === -1) continue; // from より後に to が無ければこの Pattern は該当なし

    for (const trip of pattern.trips) {
      const depSec = trip[fromIdx];
      if (depSec === undefined) continue;
      if (depSec < earliestDepartSec) continue;
      const arrSec = trip[toIdx];
      if (arrSec === undefined) continue;
      if (!best || depSec < best.depSec) {
        best = { depSec, arrSec };
      }
    }
  }

  return best;
}

export function evaluateRoute(
  network: Network,
  legs: RouteLeg[],
  departSec: number,
): RouteEvaluation {
  const transfers = legs.length - 1;

  let fare: number | null = 0;
  for (const leg of legs) {
    const line = network.lines[leg.line];
    const legFare = line ? line.fare : null;
    if (legFare === null || legFare === undefined) {
      fare = null;
      break;
    }
    fare += legFare;
  }

  let t = departSec;
  let durationSec: number | null = 0;
  let arriveSec: number | null = null;
  let broken = false;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const earliestDepart = i === 0 ? t : t + network.transferSec;
    const trip = findEarliestTrip(network, leg.line, leg.from, leg.to, earliestDepart);
    if (!trip) {
      broken = true;
      break;
    }
    t = trip.arrSec;
  }

  if (broken) {
    durationSec = null;
    arriveSec = null;
  } else {
    arriveSec = t;
    durationSec = t - departSec;
  }

  return { transfers, fare, durationSec, arriveSec };
}
