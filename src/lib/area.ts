import areasData from '../data/areas.json' with { type: 'json' };
import type { Network } from './types.ts';

/** mt3d = 首都圏（Mini Tokyo 3D収録範囲）= ネットワーク内の全駅。 */
export type AreaId = 'tokyo23' | 'tokyo' | 'mt3d';

export const AREA_LABELS: Record<AreaId, string> = {
  tokyo23: '東京23区内',
  tokyo: '東京都内',
  mt3d: '首都圏（Mini Tokyo 3D収録範囲）',
};

type Ring = [number, number][];
// MultiPolygon: 各要素がPolygon([外環, ...穴])。areas.json の生成時点で穴は含めていないため
// 実際には各Polygonは外環1つのみだが、将来穴が追加されても動くようにポリゴン全体を走査する。
type MultiPolygon = Ring[][];

type AreasFile = {
  source: string;
  generatedAt: string;
  areas: Partial<Record<Exclude<AreaId, 'mt3d'>, MultiPolygon>>;
};

const areasFile = areasData as unknown as AreasFile;

/** リング（点列）に対する ray casting によるポイントイン判定 */
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Polygon（[外環, 穴1, 穴2, ...]）に対するポイントイン判定。
 * 外環内かつどの穴にも含まれない場合に true。
 */
function pointInPolygon(lon: number, lat: number, polygon: Ring[]): boolean {
  if (polygon.length === 0) return false;
  const [outer, ...holes] = polygon;
  if (!pointInRing(lon, lat, outer)) return false;
  for (const hole of holes) {
    if (pointInRing(lon, lat, hole)) return false;
  }
  return true;
}

function pointInMultiPolygon(lon: number, lat: number, mp: MultiPolygon): boolean {
  for (const polygon of mp) {
    if (pointInPolygon(lon, lat, polygon)) return true;
  }
  return false;
}

/**
 * 指定座標が指定エリア内かどうかを ray casting で判定する。
 * 'mt3d' は常に true（全駅対象）。
 */
export function pointInArea(lon: number, lat: number, area: AreaId): boolean {
  if (area === 'mt3d') return true;
  const mp = areasFile.areas[area];
  if (!mp) return false;
  return pointInMultiPolygon(lon, lat, mp);
}

/** ネットワーク内の駅のうち、指定エリアに含まれる駅のインデックス配列を返す */
export function stationsInArea(network: Network, area: AreaId): number[] {
  const result: number[] = [];
  network.stations.forEach((station, idx) => {
    if (pointInArea(station.lon, station.lat, area)) {
      result.push(idx);
    }
  });
  return result;
}
