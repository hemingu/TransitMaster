import { MinHeap } from './heap.ts';
import { endpointStations, getNetworkIndex, outgoingSegLine } from './networkIndex.ts';
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
 *
 * 同じパターンに乗り続ける限り乗換にならない（路線をまたぐ直通運転も1回の乗車）。
 * 乗り換え = パターンの乗り換え（降りて別のパターンに乗る）。
 *
 * コストはモードごとの単一スカラーに符号化する（辞書式比較をまとめて扱うため）:
 * - 'time': 総所要秒（乗車秒＋乗換×transferSec）を最小化し、同値なら乗換回数が少ない方
 * - 'transfers': 乗換回数を最小化し、同数なら総所要秒が最小の方
 */

/** time モード: 1秒あたりのコスト単位（下位に乗換回数をタイブレークとして載せる）。 */
const TIME_UNIT = 1000;
/** transfers モード: 乗換1回あたりのコスト（秒の合計より十分大きい）。 */
const TRANSFER_UNIT = 1e10;

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
 * from/to はどちらも station index で、端点は「グループ＋駅名」で決まる（endpointStations）:
 * 最初の乗車は from と同じグループ・同じ駅名の駅レコードから、最後の降車は to と同じ
 * グループ・同じ駅名の駅レコードに限る。経路の途中の乗換にはグループ全体を使う
 * （例: 錦糸町→京成金町 で 金町(常磐線) まで行って京成金町へ乗り換えるのは可、
 * 金町(常磐線) で降りて終わりは不可）。
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
  // 末尾の1ノードは「到着駅（同グループ・同駅名のレコードで降車）」専用のゴールノード
  const destNode = B + groupCount;
  const total = destNode + 1;
  const destStations = new Set(endpointStations(network, to));

  const rideUnit = mode === 'time' ? TIME_UNIT : 1;
  const boardCost =
    mode === 'time' ? network.transferSec * TIME_UNIT + 1 : TRANSFER_UNIT + network.transferSec;

  const dist = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(total).fill(-1);
  const heap = new MinHeap();

  // 出発駅と同名の駅レコードから無料で乗車できる
  for (const s of endpointStations(network, from)) {
    for (let k = index.stationNodeStart[s]; k < index.stationNodeStart[s + 1]; k++) {
      const node = index.stationNodeList[k];
      // 直通リンクから始まる乗車は、leg の乗車駅がリンクの先の別レコードになってしまうので端点にしない
      if (outgoingSegLine(network, index, node) === LINK_SEGMENT) continue;
      dist[node] = 0;
      heap.push(0, node);
    }
  }

  /** node まで乗り続けてきた乗車の乗車ノード（親をたどる）。 */
  const rideBoardingNode = (node: number): number => {
    let cur = node;
    while (parent[cur] !== -1 && parent[cur] < B) cur = parent[cur];
    return cur;
  };
  // 到着駅に着いた乗車の終点ノードと、その1つ手前のノード（経路復元用）
  let destEnd = -1;
  let destPrev = -1;
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

    // 降車（駅のグループへ）。出発グループへ戻っての乗換は考えない（出発駅の別名レコードへ
    // 一周して乗り継ぐような経路を作らない。乗らずに降りて同グループの別名レコードへ無料で
    // 乗り継ぐ抜け道も塞ぐ）。
    const gNode = B + network.stations[index.nodeStation[node]].group;
    if (gNode !== B + fromGroup && key < dist[gNode]) {
      dist[gNode] = key;
      parent[gNode] = node;
      heap.push(key, gNode);
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
    // 到着駅（同グループ・同駅名）に「乗ってきて」着いたらゴール。乗車しただけのノードや、
    // 直通リンクで着いたレコード（leg の末尾から切り落とされる）では降車できない。
    if (
      destStations.has(index.nodeStation[next]) &&
      pattern.segLine[pos] !== LINK_SEGMENT &&
      c < dist[destNode] &&
      !(index.isRing[p] && rideBoardingNode(node) === next) // 環状を一周して乗車駅に戻るだけの乗車は除く
    ) {
      dist[destNode] = c;
      destEnd = next;
      destPrev = node;
      heap.push(c, destNode);
    }
    if (c < dist[next]) {
      dist[next] = c;
      parent[next] = node;
      heap.push(c, next);
    }
  }

  if (!Number.isFinite(dist[destNode])) return null;

  // ---- 経路復元: 到着した乗車の終点から親をたどって乗車(Ride)の列にする ----
  const rides: Ride[] = [];
  let endNode = destEnd;
  let cur = destPrev;
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
