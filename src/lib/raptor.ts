import { MinHeap } from './heap.ts';
import { getNetworkIndex, incomingSegLine, outgoingSegLine } from './networkIndex.ts';
import { LINK_SEGMENT } from './types.ts';
import type { AnswerMode, Itinerary, ItineraryLeg, Network } from './types.ts';

/**
 * 経路探索（有向パターン上の最短経路探索）。
 *
 * 時刻の概念はなく、各パターン（列車の運用単位・有向）に沿った区間所要秒の合計が指標。
 * 「パターン上のある停車位置に乗っている」状態をノード、「ある乗換グループにいる」状態を
 * もう1種類のノードとする有向グラフ上の Dijkstra 法として解く:
 *
 * - 乗車ノード (p, pos) -> (p, pos+1): 区間所要秒（環状パターンは末尾から先頭へ巡回）
 * - 乗車ノード (p, pos) -> 駅の属するグループ: 降車（コスト0）
 * - グループ -> そのグループ内の各駅の乗車ノード: 乗換ペナルティ transferSec（＋乗換1回）
 *   （出発グループからの最初の乗車だけは無料）
 * 出発・到着は乗換グループ単位（グループ内のどの駅レコードから乗って・で降りてもよい）。
 *
 * 同じパターンに乗り続ける限り乗換にならない（路線をまたぐ直通運転も1回の乗車）。
 * 乗り換え = パターンの乗り換え（降りて別のパターンに乗る）。
 *
 * コストはモードごとの単一スカラーに符号化する（辞書式比較をまとめて扱うため）:
 * - 'time': 総所要秒（乗車秒＋乗換×transferSec）を最小化し、同値なら乗換回数が少ない方
 * - 'transfers': 乗換回数を最小化し、同数なら総所要秒が最小の方
 */

/**
 * コストの桁割り当て（上位から主指標、タイブレーク、駅名タイブレーク）:
 * - time モード: 秒 * 1e6 + 乗換回数 * 1e3 + 駅名ペナルティ（0〜2）
 * - transfers モード: 乗換回数 * 1e13 + 秒 * 1e3 + 駅名ペナルティ（0〜2）
 * 駅名ペナルティは、表示された出発駅名・到着駅名と違う名前のレコードで乗る・降りるごとに +1。
 * 主指標が同値の経路の中で、表示駅名のレコードで乗降するものを優先するためだけのもの。
 */
const TIME_UNIT = 1e6;
const TIME_TRANSFER = 1e3;
const TRANSFER_UNIT = 1e13;
const SEC_UNIT_TRANSFERS = 1e3;

/** 乗車の1区間（同じパターンに乗り続ける連続乗車）。 */
interface Ride {
  pattern: number;
  /** 乗車位置・降車位置（パターン内の停車位置）。 */
  from: number;
  to: number;
}

/**
 * 1回の乗車（パターン内 from -> to）を路線ごとの区間(leg)に分割する。
 * 路線が切り替わる箇所（直通リンク）では乗換にせず、後ろの leg に through を付ける。
 * 乗車の先頭・末尾にある直通リンクは（同一グループ内の別レコードへ移るだけなので）切り落とす。
 */
function rideToLegs(network: Network, ride: Ride): ItineraryLeg[] {
  const pattern = network.patterns[ride.pattern];
  const index = getNetworkIndex(network);
  const ring = index.isRing[ride.pattern];
  const m = pattern.stops.length - 1;
  const steps = ring ? (ride.to - ride.from + m) % m : ride.to - ride.from;

  const legs: ItineraryLeg[] = [];
  let cur: ItineraryLeg | null = null;
  let pendingLink = 0;
  for (let t = 0; t < steps; t++) {
    const s = ring ? (ride.from + t) % m : ride.from + t;
    const line = pattern.segLine[s];
    const sec = pattern.segSec[s];
    if (line === LINK_SEGMENT) {
      if (legs.length > 0) {
        pendingLink += sec;
        // 同じ路線のレコード間の直通リンク（統合された路線の元 railway 間など）は leg を分割しない
        const sameLine =
          cur !== null &&
          network.stations[pattern.stops[s]].line === cur.line &&
          network.stations[pattern.stops[s + 1]].line === cur.line;
        if (!sameLine) cur = null;
      }
      continue;
    }
    if (cur !== null && cur.line === line) {
      cur.to = pattern.stops[s + 1];
      cur.rideSec += sec + pendingLink;
      pendingLink = 0;
    } else {
      cur = {
        line,
        from: pattern.stops[s],
        to: pattern.stops[s + 1],
        rideSec: sec + pendingLink,
      };
      if (legs.length > 0) cur.through = true;
      pendingLink = 0;
      legs.push(cur);
    }
  }
  return legs;
}

/**
 * 出発駅 from から到着駅 to への経路を探索する。
 * 端点は乗換グループ単位: 最初の乗車は from と同じグループの任意の駅レコードから、最後の降車は
 * to と同じグループの任意の駅レコードでよい。最適性は両端ともグループ単位で判断し、同コストの経路が
 * 複数あるときは from/to の表示駅名と同名のレコードで乗降するものを優先する。
 *
 * - 'time': 総所要秒（乗車秒＋乗換×transferSec）が最小の経路
 * - 'transfers': 乗換回数が最小で、同数なら総所要秒が最小の経路
 *
 * 出発グループ＝到着グループ、または到達不能なら null。
 */
export function searchRoute(
  network: Network,
  from: number,
  to: number,
  mode: AnswerMode
): Itinerary | null {
  const fromGroup = network.stations[from].group;
  const toGroup = network.stations[to].group;
  if (fromGroup === toGroup) return null;

  const index = getNetworkIndex(network);
  const B = index.nodeCount;
  const groupCount = network.stations.reduce((mx, s) => Math.max(mx, s.group), -1) + 1;
  const total = B + groupCount;
  const destNode = B + toGroup;
  const fromName = network.stations[from].name;
  const toName = network.stations[to].name;

  const rideUnit = mode === 'time' ? TIME_UNIT : SEC_UNIT_TRANSFERS;
  const boardCost =
    mode === 'time'
      ? network.transferSec * TIME_UNIT + TIME_TRANSFER
      : TRANSFER_UNIT + network.transferSec * SEC_UNIT_TRANSFERS;

  const dist = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(total).fill(-1);
  const heap = new MinHeap();

  // 出発グループの任意の駅レコードから無料で乗車できる（表示駅名と違う名前のレコードは僅かにペナルティ）
  for (const s of index.groupMembers.get(fromGroup) ?? []) {
    const startCost = network.stations[s].name === fromName ? 0 : 1;
    for (let k = index.stationNodeStart[s]; k < index.stationNodeStart[s + 1]; k++) {
      const node = index.stationNodeList[k];
      // 直通リンクから始まる乗車は、leg の乗車駅がリンクの先の別レコードになってしまうので端点にしない
      if (outgoingSegLine(network, index, node) === LINK_SEGMENT) continue;
      dist[node] = startCost;
      heap.push(startCost, node);
    }
  }

  for (;;) {
    const top = heap.pop();
    if (top === undefined) break;
    const { key, val: node } = top;
    if (key > dist[node]) continue;
    if (node === destNode) break;

    if (node >= B) {
      // グループにいる: 同グループの各駅の乗車ノードへ（乗換）
      const members = index.groupMembers.get(node - B) ?? [];
      const c = key + boardCost;
      for (const s of members) {
        for (let k = index.stationNodeStart[s]; k < index.stationNodeStart[s + 1]; k++) {
          const nd = index.stationNodeList[k];
          if (c < dist[nd]) {
            dist[nd] = c;
            parent[nd] = node;
            heap.push(c, nd);
          }
        }
      }
      continue;
    }

    // 降車（駅のグループへ）。出発グループへ戻っての乗換は考えない（出発駅の別レコードへ
    // 一周して乗り継ぐような経路を作らない）。到着グループへの降車は、実際に乗ってきて着いた
    // レコード（乗車しただけのノードは不可）で、入ってくる区間が直通リンクでないものに限る
    // （リンクで着いたレコードは leg の末尾から切り落とされ、コストと leg が食い違うため）。
    // 到着グループでは到着駅名と違う名前のレコードで降りるとペナルティ。
    const gNode = B + network.stations[index.nodeStation[node]].group;
    if (gNode !== B + fromGroup) {
      let c = key;
      let ok = true;
      if (gNode === destNode) {
        const ridden = parent[node] !== -1 && parent[node] < B;
        ok = ridden && incomingSegLine(network, index, node) !== LINK_SEGMENT;
        if (network.stations[index.nodeStation[node]].name !== toName) c += 1;
      }
      if (ok && c < dist[gNode]) {
        dist[gNode] = c;
        parent[gNode] = node;
        heap.push(c, gNode);
      }
    }
    // 次の停車駅へ乗り続ける
    const p = index.nodePattern[node];
    const pattern = network.patterns[p];
    const pos = index.nodePos[node];
    const start = index.patOffset[p];
    const end = index.patOffset[p + 1];
    let next: number;
    if (node + 1 < end) next = node + 1;
    else if (index.isRing[p]) next = start;
    else continue;
    const c = key + pattern.segSec[pos] * rideUnit;
    if (c < dist[next]) {
      dist[next] = c;
      parent[next] = node;
      heap.push(c, next);
    }
  }

  if (!Number.isFinite(dist[destNode])) return null;

  // ---- 経路復元: 到着した乗車の終点から親をたどって乗車(Ride)の列にする ----
  const rides: Ride[] = [];
  let endNode = parent[destNode];
  let cur = endNode;
  for (;;) {
    while (parent[cur] !== -1 && parent[cur] < B) cur = parent[cur];
    rides.push({
      pattern: index.nodePattern[cur],
      from: index.nodePos[cur],
      to: index.nodePos[endNode],
    });
    if (parent[cur] === -1) break;
    // 乗車ノードの親は乗換元のグループノード。その親が降車したノード（乗車の終点）
    endNode = parent[parent[cur]];
    cur = endNode;
  }
  rides.reverse();

  const legs: ItineraryLeg[] = [];
  let transfers = -1;
  for (const ride of rides) {
    const rideLegs = rideToLegs(network, ride);
    if (rideLegs.length === 0) continue;
    transfers++;
    legs.push(...rideLegs);
  }
  if (legs.length === 0) return null;

  const rideSec = legs.reduce((sum, leg) => sum + leg.rideSec, 0);
  return {
    legs,
    rideSec,
    totalSec: rideSec + transfers * network.transferSec,
    transfers,
  };
}
