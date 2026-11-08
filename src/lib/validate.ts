import { MinHeap } from './heap.ts';
import { endpointStations, getNetworkIndex, nextNode, outgoingSegLine } from './networkIndex.ts';
import { LINK_SEGMENT } from './types.ts';
import type { AnswerMode, Network, RouteEvaluation, RouteLeg } from './types.ts';

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
 * 駅レコード station と「同じ路線・同じ乗換グループ」の駅レコード一覧（station 自身を含む）。
 * 大江戸線の都庁前のように、同じ路線が同じ駅に複数のレコードを持つことがあるため、
 * プレイヤーが選んだ駅は「路線×駅グループ」の単位で同一視する（どのレコードを指していても同じ駅）。
 */
function sameLineRecords(network: Network, station: number): number[] {
  const st = network.stations[station];
  if (!st) return [];
  const members = getNetworkIndex(network).groupMembers.get(st.group) ?? [station];
  return members.filter((m) => network.stations[m].line === st.line);
}

/**
 * 路線 lineIdx の駅 from で「その路線に乗って、そのまま乗り続けた」ときに到達できる駅レコードの一覧
 * （直通運転で別路線へ入った先の駅を含む。from 自身は含まない）。
 * 路線 lineIdx の区間で駅 from から出るパターン（有向）に乗り、パターンを変えずに終点まで
 * （環状なら一周まで）乗り続けて停まる駅を集める。途中の区間の路線は問わない（直通リンクも越える）。
 * from は路線 lineIdx の駅レコードでなければ空。
 */
export function ridableStationsOnLine(network: Network, lineIdx: number, from: number): number[] {
  const fromStation = network.stations[from];
  if (!fromStation || fromStation.line !== lineIdx) return [];
  const index = getNetworkIndex(network);
  const out = new Set<number>();
  for (const rec of sameLineRecords(network, from)) {
    for (let k = index.stationNodeStart[rec]; k < index.stationNodeStart[rec + 1]; k++) {
      const start = index.stationNodeList[k];
      if (outgoingSegLine(network, index, start) !== lineIdx) continue;
      let node = nextNode(index, start);
      for (let guard = 0; node !== -1 && node !== start && guard < index.nodeCount; guard++) {
        out.add(index.nodeStation[node]);
        node = nextNode(index, node);
      }
    }
  }
  return [...out];
}

/** 駅レコード to が、路線 lineIdx に from で乗ってそのまま乗り続けた先（直通先を含む）に停まるか。 */
function checkThroughRide(network: Network, lineIdx: number, from: number, to: number): boolean {
  const targets = new Set(sameLineRecords(network, to));
  return ridableStationsOnLine(network, lineIdx, from).some((s) => targets.has(s));
}

/**
 * 指定した路線上で from から to へ、その路線の区間だけをたどって到達できるかを判定する。
 * 路線内でのパターンの乗換（同じ駅で別の系統に乗り換える。例: 大江戸線 新宿西口→練馬は都庁前で乗換）は許す。
 * 区間は有向（進行方向どおり）。
 *
 * さらに、路線 lineIdx に from で乗ってパターンを変えずに乗り続けた先（直通先の別路線の駅）でも到達できる
 * とみなす（ridableStationsOnLine）。
 *
 * from が路線の駅レコードでない、または to がどちらでも到達できない駅なら 'station-not-on-line'、
 * to が路線の駅でも到達できなければ 'not-connected-on-line'。到達できれば undefined。
 * from/to は同じ路線・同じ駅グループの駅レコードをすべて同一視する（sameLineRecords）。
 */
function checkLegOnLine(
  network: Network,
  lineIdx: number,
  from: number,
  to: number
): 'station-not-on-line' | 'not-connected-on-line' | undefined {
  const line = network.lines[lineIdx];
  const fromStation = network.stations[from];
  const toStation = network.stations[to];
  if (!line || !fromStation || !toStation) return 'station-not-on-line';
  if (fromStation.line !== lineIdx) return 'station-not-on-line';
  // 降車駅が別路線の駅でも、その路線へ直通する列車にそのまま乗って着けるなら有効
  // （例: 半蔵門線 永田町→三軒茶屋（田園都市線の駅））
  if (toStation.line !== lineIdx) {
    return checkThroughRide(network, lineIdx, from, to) ? undefined : 'station-not-on-line';
  }

  const adjacency = getNetworkIndex(network).lineAdjacency[lineIdx];
  const targets = new Set(sameLineRecords(network, to));
  const queue: number[] = sameLineRecords(network, from);
  const visited = new Set<number>(queue);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (targets.has(cur)) return undefined;
    for (const next of adjacency.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return checkThroughRide(network, lineIdx, from, to) ? undefined : 'not-connected-on-line';
}

export function validateRoute(
  network: Network,
  origin: number,
  destination: number,
  legs: RouteLeg[]
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

  // 端点は「グループ＋駅名」で決まる（endpointStations）。途中の乗換はグループ単位。
  const originStations = new Set(endpointStations(network, origin));
  const destinationStations = new Set(endpointStations(network, destination));

  const firstLeg = legs[0];
  if (!originStations.has(firstLeg.from)) {
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
  if (!destinationStations.has(lastLeg.to)) {
    return { valid: false, reason: 'wrong-destination', legIndex: legs.length - 1 };
  }

  return { valid: true };
}

/** time モード: 1秒あたりのコスト単位（下位に乗換回数をタイブレークとして載せる）。 */
const TIME_UNIT = 1000;
/** transfers モード: 乗換1回あたりのコスト（秒の合計より十分大きい）。 */
const TRANSFER_UNIT = 1e10;

/**
 * 確定した legs（validateRouteで有効と判定された経路）を評価し、乗車時間・乗換回数・
 * 総所要秒（乗換ペナルティ込み）を返す。
 *
 * プレイヤーの経路（路線＋乗降駅の列）を実現する乗り方のうち、モードの指標で最良のものを
 * 状態 (何番目のleg, パターン, 停車位置) 上の Dijkstra 法で求める:
 * - leg の乗車中は、その leg の路線の区間だけを進める
 * - 同じパターンに乗り続けるなら乗換にならない。leg の境目でも、同じパターンのまま
 *   （直通リンクをまたいでもよい）次の leg の乗車駅に着くなら乗換なし（直通運転）
 * - パターンを変えるなら乗換ペナルティ transferSec・乗換+1（leg の途中で同じ路線内の別系統に
 *   乗り換える場合も同様。例: 大江戸線 新宿西口→練馬は都庁前で乗換）
 * 'time' は総所要秒最小（同値なら乗換が少ない方）、'transfers' は乗換回数最小（同数なら総所要秒最小）。
 * 模範解答（searchRoute）と同じグラフ・同じコストで評価するため、模範解答の経路をそのまま
 * 評価すると模範解答と完全に同じ総所要秒・乗換回数になる。
 *
 * いずれかの leg が到達不能であれば totalSec は null。
 */
export function evaluateRoute(
  network: Network,
  legs: RouteLeg[],
  mode: AnswerMode = 'time'
): RouteEvaluation {
  const broken: RouteEvaluation = { transfers: Math.max(0, legs.length - 1), rideSec: 0, totalSec: null };
  if (legs.length === 0) return broken;

  const index = getNetworkIndex(network);
  const B = index.nodeCount;
  const rideUnit = mode === 'time' ? TIME_UNIT : 1;
  const boardCost =
    mode === 'time' ? network.transferSec * TIME_UNIT + 1 : TRANSFER_UNIT + network.transferSec;

  /**
   * 駅レコードと同一視するレコード一覧。通常は同じ路線・同じグループのレコード（sameLineRecords）。
   * 全体の出発・到着の端点（sameNameOnly）は、さらに駅名が同じものに限る
   * （同じ路線が新宿と新宿西口のように違う名前のレコードを持つとき、選んだ駅名の側だけを端点にする）。
   */
  const recordsOf = (station: number, sameNameOnly: boolean): number[] => {
    const recs = sameLineRecords(network, station);
    if (!sameNameOnly) return recs;
    const name = network.stations[station].name;
    return recs.filter((r) => network.stations[r].name === name);
  };
  /** 駅レコード（同じ路線・同じグループのレコードを同一視）の乗車ノード一覧。 */
  const nodesOfClass = (station: number, sameNameOnly = false): number[] => {
    const out: number[] = [];
    for (const rec of recordsOf(station, sameNameOnly)) {
      for (let k = index.stationNodeStart[rec]; k < index.stationNodeStart[rec + 1]; k++) {
        out.push(index.stationNodeList[k]);
      }
    }
    return out;
  };
  const last = legs.length - 1;
  const toSets = legs.map((l, k) => new Set(recordsOf(l.to, k === last)));
  const fromSets = legs.map((l, k) => new Set(recordsOf(l.from, k === 0)));
  /** ノードから出る区間の路線（終端なら undefined）。 */
  const outSegLine = (node: number): number | undefined => {
    const p = index.nodePattern[node];
    return network.patterns[p].segLine[index.nodePos[node]];
  };

  // 状態 (leg, 乗り方, ノード)。乗り方 free = leg の路線で乗車したパターンに乗り続けている状態
  // （直通先の別路線の区間も進める。パターンの乗換は不可）。通常 (0) は leg の路線の区間だけを進める。
  const dist = new Map<number, number>();
  const heap = new MinHeap();
  const relax = (k: number, node: number, cost: number, free = 0) => {
    const key = (k * 2 + free) * B + node;
    const old = dist.get(key);
    if (old === undefined || cost < old) {
      dist.set(key, cost);
      heap.push(cost, key);
    }
  };

  /** leg k の乗車ノード nd に乗る（leg の路線の区間で出発するなら、乗り続ける free 状態でも乗れる）。 */
  const board = (k: number, nd: number, cost: number) => {
    relax(k, nd, cost);
    if (outSegLine(nd) === legs[k].line) relax(k, nd, cost, 1);
  };

  for (const nd of nodesOfClass(legs[0].from, true)) board(0, nd, 0);

  let best: number | null = null;

  for (;;) {
    const top = heap.pop();
    if (top === undefined) break;
    const { key: cost, val: key } = top;
    if (cost > (dist.get(key) ?? Number.POSITIVE_INFINITY)) continue;
    const ks = Math.floor(key / B);
    const k = ks >> 1;
    const free = ks & 1;
    const node = key - ks * B;
    const leg = legs[k];

    // ---- leg の降車駅に着いた ----
    if (toSets[k].has(index.nodeStation[node])) {
      if (k === last) {
        best = cost;
        break;
      }
      const nextFrom = fromSets[k + 1];
      // (a) 同じパターンのまま（直通リンクをまたいでもよい）次の leg の乗車駅へ: 乗換なし
      let x = node;
      let acc = 0;
      for (let guard = 0; x !== -1 && guard < 1000; guard++) {
        if (nextFrom.has(index.nodeStation[x])) board(k + 1, x, cost + acc * rideUnit);
        const seg = outSegLine(x);
        if (seg !== LINK_SEGMENT) break;
        acc += network.patterns[index.nodePattern[x]].segSec[index.nodePos[x]];
        x = nextNode(index, x);
      }
      // (b) 降りて別のパターンに乗る: 乗換
      for (const nd of nodesOfClass(legs[k + 1].from)) board(k + 1, nd, cost + boardCost);
    }

    // ---- leg の路線の区間に沿って進む ----
    // free 状態なら、路線を問わずそのパターンに乗り続けられる（直通運転で別路線へ入った先も同じ leg）。
    // 同じ路線のレコード間の直通リンク（統合された路線の元 railway 間）も、その路線の leg の中では進める。
    const seg0 = outSegLine(node);
    const nx0 = seg0 === LINK_SEGMENT ? nextNode(index, node) : -1;
    const linkWithinLine =
      nx0 !== -1 &&
      network.stations[index.nodeStation[node]].line === leg.line &&
      network.stations[index.nodeStation[nx0]].line === leg.line;
    if (free || seg0 === leg.line || linkWithinLine) {
      const nx = nextNode(index, node);
      if (nx !== -1) {
        const sec = network.patterns[index.nodePattern[node]].segSec[index.nodePos[node]];
        relax(k, nx, cost + sec * rideUnit, free);
      }
    }

    // ---- 同じ駅で同じ路線の別のパターンに乗り換える（leg の途中での路線内乗換。free 状態では不可） ----
    for (const nd of free ? [] : nodesOfClass(index.nodeStation[node])) {
      if (nd !== node && index.nodePattern[nd] !== index.nodePattern[node] && outSegLine(nd) === leg.line) {
        relax(k, nd, cost + boardCost);
      }
    }
  }

  if (best === null) return broken;

  let transfers: number;
  let totalSec: number;
  if (mode === 'time') {
    totalSec = Math.floor(best / TIME_UNIT);
    transfers = best % TIME_UNIT;
  } else {
    transfers = Math.floor(best / TRANSFER_UNIT);
    totalSec = best - transfers * TRANSFER_UNIT;
  }
  return { transfers, rideSec: totalSec - transfers * network.transferSec, totalSec };
}
