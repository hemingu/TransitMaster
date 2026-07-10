import type { Line, Network, Pattern, Station } from '../src/lib/types.ts';

/**
 * 駅データ.jp（無料版）CSV 4種の生レコード。カラム名は実仕様どおり。
 * tests/fixtures/miniEkidata.ts の MiniEkidataInput はこの型を satisfies する。
 */
export interface EkidataInput {
  companies: Record<string, string>[];
  lines: Record<string, string>[];
  stations: Record<string, string>[];
  joins: Record<string, string>[];
}

/**
 * GeoJSON の最小限のローカル型（@types/geojson に依存しないための簡易宣言）。
 * N02実データの LineString Feature / FeatureCollection を表現できれば十分。
 */
export interface N02Feature {
  type: 'Feature';
  properties: {
    N02_001: string;
    N02_002: string;
    N02_003: string;
    N02_004: string;
    N02_005: string;
  };
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export interface N02FeatureCollection {
  type: 'FeatureCollection';
  features: N02Feature[];
}

/** 国土数値情報 N02（鉄道）の区間レイヤー・駅レイヤー GeoJSON 相当の生入力。 */
export interface N02Input {
  sections: N02FeatureCollection;
  stations: N02FeatureCollection;
}

export interface BuildEkidataNetworkResult {
  network: Network;
  log: string[];
}

const TRANSFER_SEC = 300;
// 表定速度に対して1.2倍の余裕（駅間の加減速・カーブ等を簡易に織り込む）を掛けて所要秒を出す係数。
const SPEED_MARGIN = 1.2;
const MIN_SEG_SEC = 45;
// 葉ペア全列挙のフォールバック閾値（これを超える葉数の木は直径パス＋分岐点->葉パスで近似する）
const MAX_LEAVES_FOR_FULL_ENUMERATION = 6;
// 隣接駅のグループ統合チェックで警告する距離閾値（メートル）
const GROUP_DISTANCE_WARN_M = 1000;
// N02駅フィーチャの投影点をekidata側グループへ統合する距離閾値（メートル）
const N02_GROUP_MERGE_DISTANCE_M = 1000;
// N02の同名連続駅（路線境界・運営会社境界での重複フィーチャ）を1つに統合する弧長差閾値（メートル）
const N02_DUP_STATION_ARC_M = 500;
// N02縫合で成分間を直線ブリッジ連結する際、これを超えるギャップは警告する（採用はする）
const N02_BRIDGE_WARN_M = 5000;
// N02縫合で、成分全体が既存チェーンからこの距離以内に収まる場合は「並行重複成分」として破棄する
// （運営会社境界などで同一区間の線形が二重に入っている断片。繋ぐと巨大な迂回が生じる）
const N02_DUP_COMPONENT_DIST_M = 1000;
const N02_SPEED_KMH = 200;

/**
 * 路線ごとの表定速度(km/h)の個別上書き（line_cdキー）。Phase 2 のレビューで調整する想定で
 * 現時点では空のまま用意しておく。
 */
export const SPEED_OVERRIDES: Record<string, number> = {};

/**
 * 路線ごとの lineType の個別上書き（line_cdキー）。分類器の誤判定を補正するために
 * Phase 2 で調整する想定で現時点では空のまま用意しておく。
 */
export const LINETYPE_OVERRIDES: Record<string, number> = {};

/** N02側の駅名からekidata側のグループへ強制的に統合したい場合の個別指定（駅名 -> station_g_cd）。 */
export const GROUP_OVERRIDES: Record<string, string> = {};

/** ハバーシン距離（メートル） */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** NFKC正規化・空白除去で駅名を正規化する（N02とekidataの表記ゆれ吸収用） */
function normalizeStationName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '');
}

/** km/h から秒/mの区間所要秒を計算する（下限 MIN_SEG_SEC、四捨五入） */
function secondsForDistance(distanceM: number, speedKmh: number, margin: number): number {
  const speedMPerSec = (speedKmh * 1000) / 3600;
  const raw = (distanceM * margin) / speedMPerSec;
  return Math.max(MIN_SEG_SEC, Math.round(raw));
}

// ============================================================
// lineType / 表定速度 分類器
// ============================================================

interface Classification {
  lineType: number;
  speedKmh: number;
}

/**
 * 路線名・会社名から lineType と表定速度(km/h)を分類する。
 * 駅データ.jp無料版には line_type カラムが無いため、名前ベースのヒューリスティックで判定する。
 * SPEED_OVERRIDES / LINETYPE_OVERRIDES による line_cd 単位の上書きは呼び出し側で適用する。
 */
function classifyLine(lineName: string, companyName: string, companyType: string): Classification {
  const combined = `${lineName} ${companyName}`;

  if (/新幹線/.test(lineName)) {
    return { lineType: 1, speedKmh: 200 };
  }
  if (/ケーブル|鋼索|ロープウェイ|索道/.test(combined)) {
    return { lineType: 0, speedKmh: 20 };
  }
  if (/市電|都電|電気軌道|路面|札幌市交通局.*電車|函館市/.test(combined)) {
    return { lineType: 4, speedKmh: 20 };
  }
  if (
    /モノレール|ニュートラム|新交通|ゆりかもめ|リニモ|シーサイドライン|ポートライナー|六甲ライナー|日暮里・舎人/.test(
      combined
    )
  ) {
    return { lineType: 5, speedKmh: 30 };
  }
  if (
    /地下鉄|メトロ|都営|Osaka Metro|大阪市高速電気軌道/.test(combined) ||
    /^(札幌|仙台|横浜|名古屋|京都|神戸|福岡)市(交通局)?$/.test(companyName)
  ) {
    return { lineType: 3, speedKmh: 35 };
  }
  if (companyType === '1') {
    // JR
    return { lineType: 2, speedKmh: 60 };
  }
  return { lineType: 2, speedKmh: 55 };
}

// ============================================================
// 路線→パターン再構成
// ============================================================

interface GraphNode {
  stationCd: string;
  neighbors: Set<string>;
}

/** line_cd ごとの無向グラフ（隣接リスト）。重複辺は自動的に除去される（Setのため）。 */
function buildLineGraph(
  stationCds: string[],
  joinPairs: [string, string][]
): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();
  for (const cd of stationCds) {
    graph.set(cd, { stationCd: cd, neighbors: new Set() });
  }
  for (const [a, b] of joinPairs) {
    if (!graph.has(a) || !graph.has(b)) continue;
    graph.get(a)!.neighbors.add(b);
    graph.get(b)!.neighbors.add(a);
  }
  return graph;
}

/** グラフを連結成分に分割する（各成分は station_cd の配列）。 */
function connectedComponents(graph: Map<string, GraphNode>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const cd of graph.keys()) {
    if (visited.has(cd)) continue;
    const stack = [cd];
    const comp: string[] = [];
    visited.add(cd);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const next of graph.get(cur)!.neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/** 成分が環状（全ノード次数2）かどうか判定する。 */
function isCycleComponent(graph: Map<string, GraphNode>, comp: string[]): boolean {
  if (comp.length < 3) return false;
  return comp.every((cd) => graph.get(cd)!.neighbors.size === 2);
}

/** 成分が木（閉路なし）かどうか判定する: 辺数 === ノード数 - 1。 */
function isTreeComponent(graph: Map<string, GraphNode>, comp: string[]): boolean {
  const nodeSet = new Set(comp);
  let edgeCount = 0;
  for (const cd of comp) {
    for (const nb of graph.get(cd)!.neighbors) {
      if (nodeSet.has(nb)) edgeCount++;
    }
  }
  edgeCount /= 2;
  return edgeCount === comp.length - 1;
}

/** 環状成分を一周ウォークして stops（末尾に始点再掲）を返す。 */
function walkCycle(graph: Map<string, GraphNode>, comp: string[]): string[] {
  const start = comp[0];
  const stops: string[] = [start];
  let prev: string | null = null;
  let cur = start;
  for (let i = 0; i < comp.length; i++) {
    const neighbors = [...graph.get(cur)!.neighbors];
    const next = neighbors.find((n) => n !== prev) ?? neighbors[0];
    if (next === start) {
      stops.push(start);
      break;
    }
    stops.push(next);
    prev = cur;
    cur = next;
  }
  return stops;
}

/** 木構造上の2ノード間の単純パスをBFSで求める。 */
function pathInTree(graph: Map<string, GraphNode>, nodeSet: Set<string>, from: string, to: string): string[] {
  const prevMap = new Map<string, string | null>();
  prevMap.set(from, null);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const nb of graph.get(cur)!.neighbors) {
      if (!nodeSet.has(nb) || prevMap.has(nb)) continue;
      prevMap.set(nb, cur);
      queue.push(nb);
    }
  }
  const path: string[] = [];
  let cur: string | null = to;
  while (cur !== null) {
    path.unshift(cur);
    cur = prevMap.get(cur) ?? null;
  }
  return path;
}

/** 木構造の葉（次数1のノード）一覧を返す。孤立ノード（次数0）1個だけの成分は特別扱いが必要なので呼び出し側で弾く。 */
function treeLeaves(graph: Map<string, GraphNode>, comp: string[]): string[] {
  return comp.filter((cd) => graph.get(cd)!.neighbors.size === 1);
}

/** 2ノード間の木上距離（辺数）を求める（直径探索用）。 */
function treeDistance(graph: Map<string, GraphNode>, nodeSet: Set<string>, from: string, to: string): number {
  return pathInTree(graph, nodeSet, from, to).length - 1;
}

/**
 * 木成分からパターン群（駅CDの配列の配列）を構築する。
 * - 葉数が MAX_LEAVES_FOR_FULL_ENUMERATION 以下: 葉ペア全列挙（L(L-1)/2パターン）
 * - それを超える場合: 直径パス＋各分岐点（次数>=3）から各葉へのパスでフォールバックしlogへ記録
 */
function buildTreePatterns(
  graph: Map<string, GraphNode>,
  comp: string[],
  lineName: string,
  log: string[]
): string[][] {
  const nodeSet = new Set(comp);
  const leaves = treeLeaves(graph, comp);

  if (leaves.length <= 1) {
    // 単一ノードや退化ケース（実質的に駅1つのみで辺がない）は除外（呼び出し側でフィルタ済み想定）
    return [];
  }

  if (leaves.length <= MAX_LEAVES_FOR_FULL_ENUMERATION) {
    const patterns: string[][] = [];
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        patterns.push(pathInTree(graph, nodeSet, leaves[i], leaves[j]));
      }
    }
    return patterns;
  }

  // フォールバック: 直径パス（最遠葉ペア）＋各分岐点から各葉へのパス
  log.push(
    `路線「${lineName}」: 葉数${leaves.length}がMAX_LEAVES_FOR_FULL_ENUMERATION(${MAX_LEAVES_FOR_FULL_ENUMERATION})を超えるため、直径パス＋分岐点->葉パスで近似する`
  );
  let bestPair: [string, string] = [leaves[0], leaves[1]];
  let bestDist = -1;
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const d = treeDistance(graph, nodeSet, leaves[i], leaves[j]);
      if (d > bestDist) {
        bestDist = d;
        bestPair = [leaves[i], leaves[j]];
      }
    }
  }
  const patterns: string[][] = [pathInTree(graph, nodeSet, bestPair[0], bestPair[1])];
  const diameterSet = new Set(patterns[0]);
  const branchPoints = comp.filter((cd) => graph.get(cd)!.neighbors.size >= 3);
  for (const bp of branchPoints) {
    for (const leaf of leaves) {
      if (diameterSet.has(leaf) && diameterSet.has(bp)) continue; // 直径パスに既に含まれる組は除外
      patterns.push(pathInTree(graph, nodeSet, bp, leaf));
    }
  }
  return patterns;
}

/**
 * 閉路と分岐が混在する成分（例: 大江戸線、函館本線の藤城支線/砂原支線の並行ルート）から
 * 近似パターン群を構築する。
 * - DFSで検出した各バックエッジごとに単純閉路を復元し、それぞれ環状パターンとして出力する
 *   （複数の閉路が節点を共有する場合＝函館本線型でも閉路単位で正しく扱える）
 * - バックエッジを除いた全域木（DFS木）に対して葉ペア列挙（buildTreePatterns）を行う
 * 木の全辺は必ずいずれかの葉ペアパス上に乗るため、成分内の全駅がパターンに
 * 含まれることが構造的に保証される。近似であることを log に記録する。
 */
function buildMixedPatterns(
  graph: Map<string, GraphNode>,
  comp: string[],
  lineName: string,
  log: string[]
): string[][] {
  log.push(
    `路線「${lineName}」: 閉路と分岐が混在する成分のため、閉路ごとの環状パターン＋全域木の葉ペアパスで近似する（近似結果です）`
  );
  const nodeSet = new Set(comp);

  // DFSで全域木（親マップ）とバックエッジを求める。無向グラフのため、訪問済みかつ
  // DFSスタック上（onStack）の隣接ノードへの辺のみをバックエッジとして1回だけ記録する。
  const visited = new Set<string>();
  const parent = new Map<string, string | null>();
  const backEdges: [string, string][] = [];
  const onStack = new Set<string>();

  const visit = (node: string, par: string | null) => {
    visited.add(node);
    parent.set(node, par);
    onStack.add(node);
    for (const nb of graph.get(node)!.neighbors) {
      if (!nodeSet.has(nb)) continue;
      if (nb === par) continue;
      if (!visited.has(nb)) {
        visit(nb, node);
      } else if (onStack.has(nb)) {
        backEdges.push([node, nb]);
      }
    }
    onStack.delete(node);
  };
  visit(comp[0], null);

  const patterns: string[][] = [];

  // 各バックエッジ [from, to]（toはfromのDFS木上の祖先）から単純閉路を復元し、
  // 環状パターン（末尾に始点再掲）として個別に出力する。
  for (const [from, to] of backEdges) {
    const cycle: string[] = [from];
    let cur = parent.get(from) ?? null;
    while (cur !== null && cur !== to) {
      cycle.push(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur !== to) {
      log.push(`路線「${lineName}」: バックエッジ ${from}-${to} の閉路復元に失敗したためスキップ`);
      continue;
    }
    cycle.push(to);
    if (cycle.length >= 3) {
      cycle.push(from); // 環状: 始点を末尾に再掲
      patterns.push(cycle);
    }
  }

  // 全域木（バックエッジを除いたDFS木）に対する葉ペア列挙。
  const treeGraph = new Map<string, GraphNode>();
  for (const cd of comp) {
    treeGraph.set(cd, { stationCd: cd, neighbors: new Set() });
  }
  for (const cd of comp) {
    const par = parent.get(cd);
    if (par !== null && par !== undefined) {
      treeGraph.get(cd)!.neighbors.add(par);
      treeGraph.get(par)!.neighbors.add(cd);
    }
  }
  patterns.push(...buildTreePatterns(treeGraph, comp, lineName, log));

  // 保険: 万一パターンから漏れた駅があればlogに記録する（構造上は発生しない想定）
  const covered = new Set<string>();
  for (const p of patterns) for (const cd of p) covered.add(cd);
  const uncovered = comp.filter((cd) => !covered.has(cd));
  if (uncovered.length > 0) {
    log.push(
      `路線「${lineName}」: 混在成分の近似処理でパターン未カバーの駅が残った: ${uncovered.join(', ')}`
    );
  }

  return patterns;
}

// ============================================================
// N02（国土数値情報）新幹線マージ
// ============================================================

interface N02Point {
  lon: number;
  lat: number;
}

function quantize(v: number, digits: number): string {
  return v.toFixed(digits);
}

/**
 * 座標配列を端点量子化でグラフ化し、次数1の端点からウォークしてポリライン群に縫合する。
 * 全セグメントがいずれかの成分に含まれるよう、次数1端点からのウォーク後に
 * 未使用セグメントが残っていれば残りの端点からもウォークする。
 * 返り値は成分ごとのポリライン（1本に繋がれば要素数1）。
 */
function stitchPolyline(segments: [number, number][][], digits: number): N02Point[][] {
  const keyOf = (pt: [number, number]) => `${quantize(pt[0], digits)},${quantize(pt[1], digits)}`;

  // 端点グラフ: quantizedKey -> 隣接端点キーのリスト（同一segmentの他端）
  const adjacency = new Map<string, { otherKey: string; segIndex: number; reversed: boolean }[]>();
  const pointByKey = new Map<string, [number, number]>();

  segments.forEach((seg, segIndex) => {
    const a = seg[0];
    const b = seg[seg.length - 1];
    const ka = keyOf(a);
    const kb = keyOf(b);
    pointByKey.set(ka, a);
    pointByKey.set(kb, b);
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka)!.push({ otherKey: kb, segIndex, reversed: false });
    adjacency.get(kb)!.push({ otherKey: ka, segIndex, reversed: true });
  });

  // 成分ごとにウォークしてポリライン化する
  const visitedSeg = new Set<number>();
  const components: N02Point[][] = [];

  // 次数1の端点（始点候補）を優先し、その後に残り全端点を並べる
  // （純粋な環状成分など、次数1端点から到達できない残余セグメントも確実にウォークするため）
  const allKeys = [...adjacency.keys()];
  const degree1Keys = allKeys.filter((k) => adjacency.get(k)!.length === 1);
  const startCandidates = [...degree1Keys, ...allKeys];

  for (const startKey of startCandidates) {
    if ([...adjacency.get(startKey)!].every((e) => visitedSeg.has(e.segIndex))) continue;
    const polyline: N02Point[] = [];
    const [lon0, lat0] = pointByKey.get(startKey)!;
    polyline.push({ lon: lon0, lat: lat0 });
    let curKey = startKey;
    let segCount = 0;
    // 無限ループ防止のためsegments.length回を上限にウォーク
    for (let step = 0; step < segments.length; step++) {
      const edges = adjacency.get(curKey)!.filter((e) => !visitedSeg.has(e.segIndex));
      if (edges.length === 0) break;
      const edge = edges[0];
      visitedSeg.add(edge.segIndex);
      segCount++;
      const seg = segments[edge.segIndex];
      const orderedSeg = edge.reversed ? [...seg].reverse() : seg;
      // 先頭点(=現在点と重複)を除いて追加
      for (let i = 1; i < orderedSeg.length; i++) {
        polyline.push({ lon: orderedSeg[i][0], lat: orderedSeg[i][1] });
      }
      curKey = edge.otherKey;
    }
    if (segCount > 0) {
      components.push(polyline);
    }
  }

  return components;
}

/** ポリラインの総延長（メートル）。 */
function polylineLengthMeters(polyline: N02Point[]): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    total += haversineMeters(polyline[i - 1].lat, polyline[i - 1].lon, polyline[i].lat, polyline[i].lon);
  }
  return total;
}

/** 点からポリライン（線分列）への最短距離（メートル）。 */
function distanceToPolylineMeters(point: N02Point, polyline: N02Point[]): number {
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    // 平面近似で線分上の最近点を求めてhaversineで距離を測る（projectPointToPolylineと同じ流儀）
    const dx = b.lon - a.lon;
    const dy = b.lat - a.lat;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((point.lon - a.lon) * dx + (point.lat - a.lat) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const distM = haversineMeters(point.lat, point.lon, a.lat + t * dy, a.lon + t * dx);
    if (distM < best) best = distM;
  }
  return best;
}

/**
 * 成分ポリラインが既存チェーンからどれだけ乖離しているかの最大値（メートル）を返す。
 * 成分上から最大20点を等間隔にサンプリングし、各点のチェーンへの最短距離の最大を取る。
 * この値が小さい成分は既存チェーンの並行重複（境界部の二重フィーチャ等）とみなせる。
 */
function maxDeviationFromChainMeters(component: N02Point[], chain: N02Point[]): number {
  const sampleCount = Math.min(20, component.length);
  let maxDev = 0;
  for (let s = 0; s < sampleCount; s++) {
    const idx = sampleCount === 1 ? 0 : Math.round((s * (component.length - 1)) / (sampleCount - 1));
    const dev = distanceToPolylineMeters(component[idx], chain);
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

/**
 * 複数の成分ポリラインを1本に連結する。
 * - 最長の成分を起点に、チェーン両端に対して「未使用成分の端点のうち最も近いもの」を
 *   貪欲に選んで延長する（チェーンのどちらの端に成分のどちらの端点を繋ぐか、4通りから最小ギャップを選ぶ）
 * - ただし選ばれた成分の全体が既存チェーンから N02_DUP_COMPONENT_DIST_M 以内に収まる場合は
 *   「並行重複成分」（運営会社境界などの二重フィーチャ）として繋がずに破棄する。
 *   重複成分を端に繋ぐと巨大な迂回ブリッジが生じ、駅の射影順序と弧長を壊すため。
 * - ブリッジごとにギャップ距離をlogへ出力し、N02_BRIDGE_WARN_M を超える場合は警告する（採用はする）。
 */
function bridgeComponents(componentsIn: N02Point[][], lineName: string, log: string[]): N02Point[] {
  const d = (a: N02Point, b: N02Point) => haversineMeters(a.lat, a.lon, b.lat, b.lon);

  // 最長の成分を起点にする
  const remaining = [...componentsIn].sort((a, b) => polylineLengthMeters(b) - polylineLengthMeters(a));
  let chain = remaining.shift()!;

  while (remaining.length > 0) {
    const chainHead = chain[0];
    const chainTail = chain[chain.length - 1];
    let bestIdx = 0;
    let bestGap = Infinity;
    let bestAttach: 'head' | 'tail' = 'tail';
    let bestReverse = false;

    remaining.forEach((comp, i) => {
      const compHead = comp[0];
      const compTail = comp[comp.length - 1];
      // attach='tail' はチェーン末尾に成分を追記（成分の先頭点がブリッジ接続点）、
      // attach='head' はチェーン先頭に成分を前置（成分の末尾点がブリッジ接続点）。
      // reverse=true は成分を逆順にしてから繋ぐ。
      const candidates: { gap: number; attach: 'head' | 'tail'; reverse: boolean }[] = [
        { gap: d(chainTail, compHead), attach: 'tail', reverse: false },
        { gap: d(chainTail, compTail), attach: 'tail', reverse: true },
        { gap: d(chainHead, compTail), attach: 'head', reverse: false },
        { gap: d(chainHead, compHead), attach: 'head', reverse: true },
      ];
      for (const c of candidates) {
        if (c.gap < bestGap) {
          bestGap = c.gap;
          bestIdx = i;
          bestAttach = c.attach;
          bestReverse = c.reverse;
        }
      }
    });

    const comp = remaining.splice(bestIdx, 1)[0];

    // 並行重複成分の破棄判定（チェーンが成長した後の状態に対して毎回評価する）
    const deviation = maxDeviationFromChainMeters(comp, chain);
    if (deviation <= N02_DUP_COMPONENT_DIST_M) {
      log.push(
        `N02縫合: 路線「${lineName}」の並行重複成分（延長${(polylineLengthMeters(comp) / 1000).toFixed(1)}km、既存ポリラインとの最大乖離${Math.round(deviation)}m）を破棄`
      );
      continue;
    }

    const oriented = bestReverse ? [...comp].reverse() : comp;
    // 単純連結により、接続点間の直線がそのままブリッジセグメントになる
    chain = bestAttach === 'tail' ? [...chain, ...oriented] : [...oriented, ...chain];

    log.push(`N02縫合ブリッジ: 路線「${lineName}」 ギャップ${Math.round(bestGap)}m`);
    if (bestGap > N02_BRIDGE_WARN_M) {
      log.push(
        `N02縫合ブリッジ警告: 路線「${lineName}」のブリッジギャップが${Math.round(bestGap)}mで5kmを超えている（そのまま採用）`
      );
    }
  }

  return chain;
}

/** ポリライン上の弧長（累積距離, メートル）配列を返す（polyline[i]までの累積距離）。 */
function polylineCumulativeDistances(polyline: N02Point[]): number[] {
  const dist = [0];
  for (let i = 1; i < polyline.length; i++) {
    const d = haversineMeters(polyline[i - 1].lat, polyline[i - 1].lon, polyline[i].lat, polyline[i].lon);
    dist.push(dist[i - 1] + d);
  }
  return dist;
}

/** 点をポリラインに射影し、射影位置での弧長（起点からの累積距離, メートル）を返す。 */
function projectPointToPolyline(point: N02Point, polyline: N02Point[], cumDist: number[]): number {
  let bestDist = Infinity;
  let bestArc = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    // 平面近似（緯度経度をそのままxy扱い。区間が短いため十分な精度）
    const ax = a.lon;
    const ay = a.lat;
    const bx = b.lon;
    const by = b.lat;
    const px = point.lon;
    const py = point.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projLon = ax + t * dx;
    const projLat = ay + t * dy;
    const distM = haversineMeters(point.lat, point.lon, projLat, projLon);
    if (distM < bestDist) {
      bestDist = distM;
      const segLen = haversineMeters(a.lat, a.lon, b.lat, b.lon);
      bestArc = cumDist[i] + t * segLen;
    }
  }
  return bestArc;
}

function n02FeatureMidpoint(feature: N02Feature): N02Point {
  const coords = feature.geometry.coordinates;
  const mid = coords[Math.floor((coords.length - 1) / 2)];
  // 偶数長の場合は中間2点の平均を取る
  if (coords.length % 2 === 0 && coords.length >= 2) {
    const a = coords[coords.length / 2 - 1];
    const b = coords[coords.length / 2];
    return { lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 };
  }
  return { lon: mid[0], lat: mid[1] };
}

interface N02MergeResult {
  lines: Line[];
  stationsToAdd: Station[];
  groupAssignments: Map<number, number>; // stationsToAddのローカルindex -> 既存または新規group
}

/**
 * N02（国土数値情報）から新幹線区間・駅を取り込み、Line群と追加すべきStation群を作る。
 * ekidata側の駅グループ（groupByStationName: 正規化駅名 -> {group, lat, lon}[]）と
 * 名前一致＋距離1km以内で統合する。統合できない場合は新規groupを割り当てる。
 */
function mergeN02(
  n02: N02Input,
  ekidataGroupsByName: Map<string, { group: number; lat: number; lon: number }[]>,
  nextGroupIdRef: { value: number },
  log: string[]
): N02MergeResult {
  // 区間をN02_003（路線名）でグループ化
  const sectionsByLine = new Map<string, N02Feature[]>();
  for (const f of n02.sections.features) {
    if (f.properties.N02_002 !== '1') continue; // 新幹線のみ
    const arr = sectionsByLine.get(f.properties.N02_003) ?? [];
    arr.push(f);
    sectionsByLine.set(f.properties.N02_003, arr);
  }

  const stationsByLine = new Map<string, N02Feature[]>();
  for (const f of n02.stations.features) {
    if (f.properties.N02_002 !== '1') continue;
    const arr = stationsByLine.get(f.properties.N02_003) ?? [];
    arr.push(f);
    stationsByLine.set(f.properties.N02_003, arr);
  }

  const lines: Line[] = [];
  const stationsToAdd: Station[] = [];
  const groupAssignments = new Map<number, number>();

  for (const [lineName, sectionFeatures] of sectionsByLine) {
    const stationFeatures = stationsByLine.get(lineName) ?? [];
    if (stationFeatures.length === 0) {
      log.push(`N02路線「${lineName}」: 対応する駅フィーチャが見つからないためスキップ`);
      continue;
    }

    const segments = sectionFeatures.map((f) => f.geometry.coordinates);
    let components = stitchPolyline(segments, 5);
    if (components.length > 1) {
      log.push(
        `N02路線「${lineName}」: 座標量子化5桁での縫合が${components.length}成分に分かれたため4桁でリトライする`
      );
      const retry = stitchPolyline(segments, 4);
      if (retry.length < components.length) {
        components = retry;
      }
    }

    let polyline: N02Point[];
    if (components.length === 0) {
      polyline = [];
    } else if (components.length > 1) {
      // 成分を捨てると以降の駅が全て終端付近に射影されて弧長差が潰れるため、
      // 近接端点を直線ブリッジで繋いで全成分を1本に連結する。
      log.push(
        `N02路線「${lineName}」: 縫合後も${components.length}成分に分かれているため、近接端点を直線ブリッジで連結する`
      );
      polyline = bridgeComponents(components, lineName, log);
    } else {
      polyline = components[0];
    }

    if (polyline.length < 2) {
      log.push(`N02路線「${lineName}」: 縫合後のポリラインが不正のためスキップ`);
      continue;
    }

    const cumDist = polylineCumulativeDistances(polyline);

    // 会社名（N02_004）: 区間フィーチャの出現順ユニークを「・」連結
    const companyNames: string[] = [];
    for (const f of sectionFeatures) {
      if (!companyNames.includes(f.properties.N02_004)) companyNames.push(f.properties.N02_004);
    }
    const company = companyNames.join('・');

    // 駅フィーチャの中点をポリラインへ射影し、弧長でソートして停車順を決定
    const projectedRaw = stationFeatures.map((f) => {
      const mid = n02FeatureMidpoint(f);
      const arc = projectPointToPolyline(mid, polyline, cumDist);
      return { name: f.properties.N02_005, mid, arc };
    });
    projectedRaw.sort((a, b) => a.arc - b.arc);

    // 同名連続駅のdedupe: N02元データは路線境界・運営会社境界で同一駅の駅フィーチャが
    // 重複することがある（例: 東海道/山陽の境界の新大阪、北陸のJR東/JR西境界の上越妙高）。
    // 弧長ソート後に隣接する同名駅（NFKC正規化一致）で弧長差が小さいものは先の方を残す。
    const projected: typeof projectedRaw = [];
    for (const p of projectedRaw) {
      const last = projected[projected.length - 1];
      if (
        last !== undefined &&
        normalizeStationName(last.name) === normalizeStationName(p.name) &&
        p.arc - last.arc <= N02_DUP_STATION_ARC_M
      ) {
        log.push(
          `N02重複駅統合: 路線「${lineName}」の「${p.name}」の連続する重複フィーチャを1つに統合（弧長差${Math.round(p.arc - last.arc)}m）`
        );
        continue;
      }
      projected.push(p);
    }

    const stopStationIndices: number[] = [];
    for (const p of projected) {
      const normName = normalizeStationName(p.name);
      let assignedGroup: number | null = null;

      if (GROUP_OVERRIDES[p.name] !== undefined) {
        // GROUP_OVERRIDES は station_g_cd 文字列を指すため、ekidata側の該当グループ番号解決は
        // 呼び出し側（本体）でマッピング済みの ekidataGroupsByName を通じて解決する。
        // ここでは名前一致がある場合のみ簡易対応する。
        const override = ekidataGroupsByName.get(normalizeStationName(GROUP_OVERRIDES[p.name]));
        if (override && override.length > 0) {
          assignedGroup = override[0].group;
        }
      }

      if (assignedGroup === null) {
        const candidates = ekidataGroupsByName.get(normName);
        if (candidates) {
          for (const cand of candidates) {
            const distM = haversineMeters(p.mid.lat, p.mid.lon, cand.lat, cand.lon);
            if (distM <= N02_GROUP_MERGE_DISTANCE_M) {
              assignedGroup = cand.group;
              break;
            }
          }
        }
      }

      let stationIdxInAddList: number;
      if (assignedGroup !== null) {
        stationIdxInAddList = stationsToAdd.length;
        stationsToAdd.push({ name: p.name, lat: p.mid.lat, lon: p.mid.lon, group: assignedGroup });
        groupAssignments.set(stationIdxInAddList, assignedGroup);
        log.push(`N02駅統合: 「${p.name}」(N02) -> 既存group ${assignedGroup}（ekidata側と1km以内一致）`);
      } else {
        const newGroup = nextGroupIdRef.value++;
        stationIdxInAddList = stationsToAdd.length;
        stationsToAdd.push({ name: p.name, lat: p.mid.lat, lon: p.mid.lon, group: newGroup });
        groupAssignments.set(stationIdxInAddList, newGroup);
        log.push(`N02駅統合: 「${p.name}」(N02) -> 新規group ${newGroup}（ekidata側に一致なし）`);
      }
      stopStationIndices.push(stationIdxInAddList);
    }

    // segSec: 弧長差 ÷ 200km/h（マージン1.2倍は掛けない）
    const segSec: number[] = [];
    for (let i = 1; i < projected.length; i++) {
      const distM = projected[i].arc - projected[i - 1].arc;
      segSec.push(secondsForDistance(distM, N02_SPEED_KMH, 1));
    }

    lines.push({
      name: lineName,
      company,
      color: null,
      lineType: 1,
      // stopStationIndicesはstationsToAdd配列内のローカルindexであり、
      // 本体側でグローバルstation indexへオフセット変換してから使用する。
      patterns: [{ stops: stopStationIndices, segSec }],
    });

    log.push(
      `N02路線「${lineName}」: 停車順 ${projected.map((p) => p.name).join(' -> ')}（事業者: ${company}）`
    );
  }

  return { lines, stationsToAdd, groupAssignments };
}

// ============================================================
// メイン本体
// ============================================================

export function buildEkidataNetwork(
  input: EkidataInput,
  n02: N02Input | null
): BuildEkidataNetworkResult {
  const log: string[] = [];

  // ---- company / line / station を e_status==='0' でフィルタ ----
  const activeCompanies = input.companies.filter((c) => c.e_status === '0');
  const activeLines = input.lines.filter((l) => l.e_status === '0');
  const activeStationsRaw = input.stations.filter((s) => s.e_status === '0');

  const companyByCd = new Map<string, Record<string, string>>();
  for (const c of activeCompanies) companyByCd.set(c.company_cd, c);

  const lineByCd = new Map<string, Record<string, string>>();
  for (const l of activeLines) lineByCd.set(l.line_cd, l);

  const stationByCd = new Map<string, Record<string, string>>();
  for (const s of activeStationsRaw) stationByCd.set(s.station_cd, s);

  // 除外駅を参照する join 行をドロップ
  const validJoins: { line_cd: string; a: string; b: string }[] = [];
  for (const j of input.joins) {
    const a = j.station_cd1;
    const b = j.station_cd2;
    if (!stationByCd.has(a) || !stationByCd.has(b)) {
      log.push(`join除外: line_cd=${j.line_cd} ${a}-${b}（廃駅または存在しない駅を参照）`);
      continue;
    }
    if (!lineByCd.has(j.line_cd)) {
      log.push(`join除外: line_cd=${j.line_cd} ${a}-${b}（廃止路線を参照）`);
      continue;
    }
    validJoins.push({ line_cd: j.line_cd, a, b });
  }

  // どのjoinにも現れない駅を検出（孤立駅として除外）
  const stationCdsInJoins = new Set<string>();
  for (const j of validJoins) {
    stationCdsInJoins.add(j.a);
    stationCdsInJoins.add(j.b);
  }
  const isolatedStationCds: string[] = [];
  for (const cd of stationByCd.keys()) {
    if (!stationCdsInJoins.has(cd)) {
      isolatedStationCds.push(cd);
    }
  }
  for (const cd of isolatedStationCds) {
    const s = stationByCd.get(cd)!;
    log.push(`孤立駅除外: station_cd=${cd} 駅名=${s.station_name}（どのjoinにも現れない）`);
  }

  // ---- station_g_cd -> group連番 の割り当て ----
  const groupIdByGCd = new Map<string, number>();
  function ensureGroupId(gCd: string): number {
    let gid = groupIdByGCd.get(gCd);
    if (gid === undefined) {
      gid = groupIdByGCd.size;
      groupIdByGCd.set(gCd, gid);
    }
    return gid;
  }

  // グループ内最大距離チェック用: group -> 座標配列
  const groupCoords = new Map<number, { lat: number; lon: number; name: string }[]>();

  // ---- 路線ごとにjoinをグルーピング ----
  const joinsByLine = new Map<string, [string, string][]>();
  for (const j of validJoins) {
    const arr = joinsByLine.get(j.line_cd) ?? [];
    arr.push([j.a, j.b]);
    joinsByLine.set(j.line_cd, arr);
  }

  const lines: Line[] = [];
  // グローバルなStation配列とstation_cd -> global indexのマップ（路線ごとのローカル生成後にまとめる）
  const stations: Station[] = [];
  const globalIndexByStationCd = new Map<string, number>();

  function ensureStationIndex(stationCd: string): number {
    let idx = globalIndexByStationCd.get(stationCd);
    if (idx !== undefined) return idx;
    const rec = stationByCd.get(stationCd)!;
    const gid = ensureGroupId(rec.station_g_cd);
    idx = stations.length;
    const lat = parseFloat(rec.lat);
    const lon = parseFloat(rec.lon);
    stations.push({ name: rec.station_name, lat, lon, group: gid });
    globalIndexByStationCd.set(stationCd, idx);
    const arr = groupCoords.get(gid) ?? [];
    arr.push({ lat, lon, name: rec.station_name });
    groupCoords.set(gid, arr);
    return idx;
  }

  for (const [lineCd, pairs] of joinsByLine) {
    const lineRec = lineByCd.get(lineCd)!;
    const companyRec = companyByCd.get(lineRec.company_cd);
    if (!companyRec) {
      log.push(`路線除外: line_cd=${lineCd}（事業者情報が見つからない/廃止事業者）`);
      continue;
    }

    const stationCdsInLine = new Set<string>();
    for (const [a, b] of pairs) {
      stationCdsInLine.add(a);
      stationCdsInLine.add(b);
    }
    const graph = buildLineGraph([...stationCdsInLine], pairs);
    const components = connectedComponents(graph);

    if (components.length > 1) {
      log.push(
        `路線「${lineRec.line_name}」: 連結成分が${components.length}個に分かれている（飛び地）ため、成分ごとに個別処理する`
      );
    }

    // ---- lineType / 速度分類 ----
    const classification = classifyLine(lineRec.line_name, companyRec.company_name, companyRec.company_type);
    const lineType = LINETYPE_OVERRIDES[lineCd] ?? classification.lineType;
    const speedKmh = SPEED_OVERRIDES[lineCd] ?? classification.speedKmh;
    log.push(
      `路線分類: 「${lineRec.line_name}」(${companyRec.company_name}) line_cd=${lineCd} -> lineType=${lineType}, 表定速度=${speedKmh}km/h`
    );

    const patternsForLine: Pattern[] = [];

    for (const comp of components) {
      if (comp.length < 2) continue; // 単独ノード（辺なし）は駅として扱えるパターンが無いためスキップ

      let stopCdPatterns: string[][];
      if (isCycleComponent(graph, comp)) {
        stopCdPatterns = [walkCycle(graph, comp)];
      } else if (isTreeComponent(graph, comp)) {
        stopCdPatterns = buildTreePatterns(graph, comp, lineRec.line_name, log);
      } else {
        stopCdPatterns = buildMixedPatterns(graph, comp, lineRec.line_name, log);
      }

      for (const stopCds of stopCdPatterns) {
        if (stopCds.length < 2) continue;
        const stopIndices = stopCds.map((cd) => ensureStationIndex(cd));
        const segSec: number[] = [];
        for (let i = 1; i < stopCds.length; i++) {
          const aRec = stationByCd.get(stopCds[i - 1])!;
          const bRec = stationByCd.get(stopCds[i])!;
          const distM = haversineMeters(
            parseFloat(aRec.lat),
            parseFloat(aRec.lon),
            parseFloat(bRec.lat),
            parseFloat(bRec.lon)
          );
          segSec.push(secondsForDistance(distM, speedKmh, SPEED_MARGIN));
        }
        patternsForLine.push({ stops: stopIndices, segSec });
      }
    }

    if (patternsForLine.length === 0) {
      log.push(`路線「${lineRec.line_name}」: 有効なパターンが構築できなかったためスキップ`);
      continue;
    }

    const colorRaw = lineRec.line_color_c?.trim();
    const color = colorRaw ? colorRaw.replace(/^#/, '') : null;

    lines.push({
      name: lineRec.line_name,
      company: companyRec.company_name,
      color,
      lineType,
      patterns: patternsForLine,
    });
  }

  // グループ内最大距離チェック
  for (const [gid, coords] of groupCoords) {
    if (coords.length < 2) continue;
    let maxDist = 0;
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        const d = haversineMeters(coords[i].lat, coords[i].lon, coords[j].lat, coords[j].lon);
        if (d > maxDist) maxDist = d;
      }
    }
    if (maxDist > GROUP_DISTANCE_WARN_M) {
      log.push(
        `グループ距離警告: group=${gid}（${coords[0].name}）内の駅間最大距離が${Math.round(maxDist)}mで1kmを超えている`
      );
    }
  }

  // ---- N02新幹線マージ ----
  if (n02 !== null) {
    const ekidataGroupsByName = new Map<string, { group: number; lat: number; lon: number }[]>();
    stations.forEach((s, idx) => {
      void idx;
      const norm = normalizeStationName(s.name);
      const arr = ekidataGroupsByName.get(norm) ?? [];
      arr.push({ group: s.group, lat: s.lat, lon: s.lon });
      ekidataGroupsByName.set(norm, arr);
    });

    const nextGroupIdRef = { value: groupIdByGCd.size };
    const { lines: n02Lines, stationsToAdd } = mergeN02(n02, ekidataGroupsByName, nextGroupIdRef, log);

    const offset = stations.length;
    for (const s of stationsToAdd) {
      stations.push(s);
    }
    for (const line of n02Lines) {
      for (const pattern of line.patterns) {
        pattern.stops = pattern.stops.map((localIdx) => localIdx + offset);
      }
    }
    lines.push(...n02Lines);
  } else {
    log.push('N02入力が指定されていないため、新幹線マージをスキップした（新幹線なしでビルド）');
  }

  // ---- 最終アサーション ----
  for (const line of lines) {
    for (const pattern of line.patterns) {
      if (pattern.stops.length < 2) {
        throw new Error(`路線「${line.name}」に停車駅数2未満のパターンが存在する`);
      }
      for (const s of pattern.segSec) {
        if (!(s > 0)) {
          throw new Error(`路線「${line.name}」に0以下のsegSecが存在する`);
        }
      }
    }
  }

  const network: Network = {
    formatVersion: 2,
    stations,
    lines,
    transferSec: TRANSFER_SEC,
  };

  return { network, log };
}
