import { LINK_SEGMENT } from './types.ts';
import type { Network } from './types.ts';

/**
 * Network から導出される高速検索用インデックス。Network 自体は不変データなので
 * WeakMap でメモ化し、同一参照に対する再計算を避ける。
 *
 * 「ノード」= (パターン, 停車位置) の組。全パターンの全停車位置に連番（node id）を振る。
 * 環状パターンは末尾の再掲位置を持たない（実長 m = stops.length - 1 個のノード）。
 */
export interface NetworkIndex {
  /** グループID -> そのグループに属する駅index一覧。 */
  groupMembers: Map<number, number[]>;
  /** patOffset[p] = パターン p の先頭ノードid。長さ patterns.length + 1。 */
  patOffset: Int32Array;
  /** 総ノード数。 */
  nodeCount: number;
  /** ノードid -> パターンindex。 */
  nodePattern: Int32Array;
  /** ノードid -> パターン内の停車位置。 */
  nodePos: Int32Array;
  /** ノードid -> 駅index。 */
  nodeStation: Int32Array;
  /** パターンが環状か（stops[0] === stops[last] かつ stops.length >= 4）。 */
  isRing: boolean[];
  /** stationNodeStart[s]..stationNodeStart[s+1] が、駅 s が登場するノードidの範囲（stationNodeList 内）。 */
  stationNodeStart: Int32Array;
  stationNodeList: Int32Array;
  /** 路線index -> その路線の駅レコードが属する乗換グループの集合。 */
  lineGroups: Set<number>[];
  /** 路線index -> その路線の駅レコード（station index）一覧。 */
  lineStations: number[][];
  /**
   * 路線index -> 駅レコード -> その路線の区間（segLine === 路線）で直接つながる次駅レコードの一覧（有向）。
   * 路線内でのパターン乗換を許した到達可能性判定（validateRoute）に使う。
   */
  lineAdjacency: Map<number, number[]>[];
}

const cache = new WeakMap<Network, NetworkIndex>();

/**
 * 出題の端点（出発駅・到着駅）として扱う駅レコード一覧: 指定駅と「同じ乗換グループ かつ 同じ駅名」の全レコード。
 * 表示される駅名が端点を決める。同名レコードは路線ごとに複数ありうる（例: 新宿）ので、それらはすべて有効な端点。
 * 同じグループでも駅名が違うレコード（例: 金町と京成金町、新宿と新宿西口）は端点に含まれない
 * （経路の途中での乗換にはグループ全体を使う）。指定駅自身を必ず含む。
 */
export function endpointStations(network: Network, stationIdx: number): number[] {
  const st = network.stations[stationIdx];
  if (!st) return [];
  const members = getNetworkIndex(network).groupMembers.get(st.group) ?? [stationIdx];
  return members.filter((m) => network.stations[m].name === st.name);
}

/** ノードから出る区間の路線（直通リンクなら LINK_SEGMENT、非環状パターンの終端なら undefined）。 */
export function outgoingSegLine(network: Network, index: NetworkIndex, node: number): number | undefined {
  return network.patterns[index.nodePattern[node]].segLine[index.nodePos[node]];
}

/**
 * ノードへ入ってくる区間の路線（直通リンクなら LINK_SEGMENT、非環状パターンの先頭なら undefined）。
 * 到着駅での降車は、入ってくる区間が直通リンクだと leg の末尾が（リンクを切り落として）
 * 手前のレコードになってしまうため、リンクで着いたレコードは端点（降車駅）にできない。
 */
export function incomingSegLine(network: Network, index: NetworkIndex, node: number): number | undefined {
  const p = index.nodePattern[node];
  const pos = index.nodePos[node];
  const segLine = network.patterns[p].segLine;
  if (pos > 0) return segLine[pos - 1];
  return index.isRing[p] ? segLine[segLine.length - 1] : undefined;
}

/** 次のノードid（同一パターン内。非環状の終端なら -1）。 */
export function nextNode(index: NetworkIndex, node: number): number {
  const p = index.nodePattern[node];
  const start = index.patOffset[p];
  const end = index.patOffset[p + 1];
  if (node + 1 < end) return node + 1;
  return index.isRing[p] ? start : -1;
}

export function getNetworkIndex(network: Network): NetworkIndex {
  const cached = cache.get(network);
  if (cached) return cached;

  const n = network.stations.length;
  const P = network.patterns.length;

  // ---- groupMembers ----
  const groupMembers = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const g = network.stations[i].group;
    const arr = groupMembers.get(g);
    if (arr) arr.push(i);
    else groupMembers.set(g, [i]);
  }

  // ---- ノード採番 ----
  const isRing: boolean[] = new Array(P);
  const patOffset = new Int32Array(P + 1);
  for (let p = 0; p < P; p++) {
    const { stops } = network.patterns[p];
    const ring = stops.length >= 4 && stops[0] === stops[stops.length - 1];
    isRing[p] = ring;
    patOffset[p + 1] = patOffset[p] + (ring ? stops.length - 1 : stops.length);
  }
  const nodeCount = patOffset[P];
  const nodePattern = new Int32Array(nodeCount);
  const nodePos = new Int32Array(nodeCount);
  const nodeStation = new Int32Array(nodeCount);
  const counts = new Int32Array(n + 1);
  for (let p = 0; p < P; p++) {
    const { stops } = network.patterns[p];
    const len = patOffset[p + 1] - patOffset[p];
    for (let pos = 0; pos < len; pos++) {
      const id = patOffset[p] + pos;
      nodePattern[id] = p;
      nodePos[id] = pos;
      nodeStation[id] = stops[pos];
      counts[stops[pos] + 1]++;
    }
  }
  const stationNodeStart = new Int32Array(n + 1);
  for (let s = 0; s < n; s++) stationNodeStart[s + 1] = stationNodeStart[s] + counts[s + 1];
  const fill = stationNodeStart.slice(0, n);
  const stationNodeList = new Int32Array(nodeCount);
  for (let id = 0; id < nodeCount; id++) stationNodeList[fill[nodeStation[id]]++] = id;

  // ---- 路線ごとの索引 ----
  const L = network.lines.length;
  const lineGroups: Set<number>[] = Array.from({ length: L }, () => new Set<number>());
  const lineStations: number[][] = Array.from({ length: L }, () => []);
  for (let s = 0; s < n; s++) {
    const st = network.stations[s];
    lineStations[st.line].push(s);
    lineGroups[st.line].add(st.group);
  }
  const lineAdjacency: Map<number, number[]>[] = Array.from({ length: L }, () => new Map());
  for (const pattern of network.patterns) {
    for (let i = 0; i < pattern.segLine.length; i++) {
      let line = pattern.segLine[i];
      if (line === LINK_SEGMENT) {
        // 統合された路線の元の railway 同士をつなぐ直通リンク（両端が同じ路線のレコード）は、その路線内の隣接として扱う
        const a = network.stations[pattern.stops[i]].line;
        if (a !== network.stations[pattern.stops[i + 1]].line) continue;
        line = a;
      }
      const adj = lineAdjacency[line];
      const from = pattern.stops[i];
      const to = pattern.stops[i + 1];
      const list = adj.get(from);
      if (!list) adj.set(from, [to]);
      else if (!list.includes(to)) list.push(to);
    }
  }

  const index: NetworkIndex = {
    groupMembers,
    patOffset,
    nodeCount,
    nodePattern,
    nodePos,
    nodeStation,
    isRing,
    stationNodeStart,
    stationNodeList,
    lineGroups,
    lineStations,
    lineAdjacency,
  };
  cache.set(network, index);
  return index;
}
