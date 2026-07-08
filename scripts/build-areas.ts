/**
 * エリア境界データ (src/data/areas.json) を生成するスクリプト。
 *
 * 公開オープンデータ（niiyz/JapanCityGeoJson の市区町村ポリゴン、dataofjapan/land の
 * 都道府県ポリゴン）を取得し、各エリア（東京23区内/東京都内/名古屋市内/大阪市内）ごとに
 * 外環のみの MultiPolygon に統合、Douglas-Peucker で簡略化して出力する。
 * 'japan' はポリゴン不要（全駅対象のため areas.json には含めない）。
 *
 * ネットワークアクセスに失敗した場合は、主要駅を内包する程度の精度の手作り粗ポリゴンに
 * フォールバックする。
 *
 * 実行: npx tsx scripts/build-areas.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Ring = [number, number][];
type MultiPolygon = Ring[][]; // MultiPolygon.coordinates 相当（各要素 = Polygon = [外環, ...穴]）

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_PATH = resolve(ROOT, 'src', 'data', 'areas.json');

// 東京23区 (13101-13123)
const TOKYO23_CODES = Array.from({ length: 23 }, (_, i) => `131${String(i + 1).padStart(2, '0')}`);
// 名古屋市16区 (23101-23116)
const NAGOYA_CODES = Array.from({ length: 16 }, (_, i) => `231${String(i + 1).padStart(2, '0')}`);
// 大阪市24区 (27102-27128、欠番あり)
const OSAKA_CODES = [
  '27102', '27103', '27104', '27106', '27107', '27108', '27109', '27111', '27113', '27114',
  '27115', '27116', '27117', '27118', '27119', '27120', '27121', '27122', '27123', '27124',
  '27125', '27126', '27127', '27128',
];

const CITY_GEOJSON_BASE = 'https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/geojson';
const PREF_GEOJSON_URL = 'https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson';

const FETCH_TIMEOUT_MS = 15000;

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** GeoJSON Polygon/MultiPolygon の座標から、全リング（外環+穴含む）を集める */
function extractRings(geometry: any): Ring[] {
  const rings: Ring[] = [];
  if (!geometry) return rings;
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      rings.push(ring.map((c: number[]) => [c[0], c[1]] as [number, number]));
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      for (const ring of poly) {
        rings.push(ring.map((c: number[]) => [c[0], c[1]] as [number, number]));
      }
    }
  }
  return rings;
}

/** 市区町村コード群のポリゴンを取得し、全ての外環リング（穴は無視）をまとめて返す */
async function fetchCityOuterRings(pref: string, codes: string[]): Promise<Ring[]> {
  const rings: Ring[] = [];
  for (const code of codes) {
    const url = `${CITY_GEOJSON_BASE}/${pref}/${code}.json`;
    try {
      const geo = await fetchJson(url);
      for (const feature of geo.features ?? []) {
        const featureRings = extractRings(feature.geometry);
        // 穴（内側リング）は無視し、外環のみを採用する（各Polygonの最初のリングを外環とみなす）
        if (feature.geometry?.type === 'Polygon') {
          if (featureRings.length > 0) rings.push(featureRings[0]);
        } else if (feature.geometry?.type === 'MultiPolygon') {
          let idx = 0;
          for (const poly of feature.geometry.coordinates) {
            if (poly.length > 0) rings.push(featureRings[idx]);
            idx += poly.length;
          }
        }
      }
      console.log(`  取得成功: ${pref}/${code} (${geo.features?.length ?? 0} features)`);
    } catch (err) {
      console.warn(`  スキップ (取得失敗): ${pref}/${code}: ${(err as Error).message}`);
    }
  }
  return rings;
}

/** 都道府県ポリゴン(japan.geojson)から指定 id の外環リング群を取得 */
async function fetchPrefectureOuterRings(prefId: number): Promise<Ring[]> {
  const geo = await fetchJson(PREF_GEOJSON_URL);
  const rings: Ring[] = [];
  for (const feature of geo.features ?? []) {
    if (feature.properties?.id !== prefId) continue;
    const geometry = feature.geometry;
    if (geometry?.type === 'Polygon') {
      const r = extractRings(geometry);
      if (r.length > 0) rings.push(r[0]);
    } else if (geometry?.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates) {
        if (poly.length > 0) {
          rings.push(poly[0].map((c: number[]) => [c[0], c[1]] as [number, number]));
        }
      }
    }
  }
  return rings;
}

/** 2点間の垂直距離（Douglas-Peucker用、平面近似で十分） */
function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(x - projX, y - projY);
}

/** Douglas-Peucker によるリングの簡略化（度単位の許容誤差） */
function douglasPeucker(points: Ring, epsilon: number): Ring {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function simplifyRing(ring: Ring, epsilonDeg: number): Ring {
  if (ring.length <= 4) return ring;
  const simplified = douglasPeucker(ring, epsilonDeg);
  // 最低でも三角形として閉じるために4点(始点=終点含む)を確保
  if (simplified.length < 4) return ring.length > 4 ? [ring[0], ring[Math.floor(ring.length / 3)], ring[Math.floor((2 * ring.length) / 3)], ring[0]] : ring;
  return simplified;
}

/** リングの符号付き面積（シューレース公式）。時計回り/反時計回り判定・面積フィルタに使う */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** 小さすぎるリング（諸島の点在など）を除去して主要な陸地のみ残す（フィーチャ数削減のため） */
function filterSignificantRings(rings: Ring[], minAreaRatio = 0.02): Ring[] {
  if (rings.length === 0) return rings;
  const areas = rings.map((r) => Math.abs(ringArea(r)));
  const maxArea = Math.max(...areas);
  return rings.filter((_, i) => areas[i] >= maxArea * minAreaRatio);
}

function buildMultiPolygon(rings: Ring[], epsilonDeg: number): MultiPolygon {
  const significant = filterSignificantRings(rings);
  const simplified = significant.map((r) => simplifyRing(r, epsilonDeg));
  return simplified.map((ring) => [ring]); // 各リングを穴なしPolygonとして扱う
}

// ---- フォールバック用の手作り粗ポリゴン ----
// 各エリアの主要駅を内包し、隣接する都市の主要駅を除外する程度の精度（10〜20頂点）。
function fallbackAreas(): Record<'tokyo23' | 'tokyo' | 'nagoya' | 'osaka', MultiPolygon> {
  // 東京23区: 荒川・多摩川・東京湾におおよそ沿った粗い外形
  const tokyo23Ring: Ring = [
    [139.56, 35.61], // 大田区南西
    [139.62, 35.55], // 東京湾岸(南)
    [139.78, 35.60], // 東京湾岸(南東)
    [139.86, 35.63], // 江戸川区東端
    [139.90, 35.72], // 葛飾区北東
    [139.86, 35.79], // 足立区北
    [139.75, 35.81], // 北区北
    [139.68, 35.80], // 練馬区北
    [139.56, 35.78], // 練馬区西
    [139.53, 35.70], // 杉並区西
    [139.54, 35.63], // 世田谷区西
    [139.56, 35.61],
  ];

  // 東京都: 23区に加え多摩地域（八王子・青梅・奥多摩・島嶼除く）を含む粗い外形
  const tokyoRing: Ring = [
    [138.94, 35.53], // 奥多摩・山梨県境付近(南西)
    [139.0, 35.35], // 丹沢山地県境(南西)
    [139.35, 35.13], // 神奈川県境(南、伊豆諸島は含めない)
    [139.62, 35.48], // 川崎市境
    [139.78, 35.52], // 東京湾岸(南)
    [139.92, 35.63], // 江戸川区東端
    [139.92, 35.80], // 足立区・埼玉県境(東)
    [139.75, 35.90], // 埼玉県境(北)
    [139.4, 35.95], // 埼玉県境(北西、青梅)
    [139.05, 35.85], // 奥多摩・埼玉/山梨県境(北西)
    [138.94, 35.53],
  ];

  // 名古屋市16区の粗い外形
  const nagoyaRing: Ring = [
    [136.82, 35.06], // 南区南西
    [136.98, 35.08], // 緑区南東
    [137.02, 35.15], // 名東区東
    [136.98, 35.24], // 守山区北
    [136.90, 35.26], // 北区北
    [136.82, 35.22], // 中村区西
    [136.78, 35.15], // 中川区西
    [136.82, 35.06],
  ];

  // 大阪市24区の粗い外形
  const osakaRing: Ring = [
    [135.43, 34.58], // 住之江区南西
    [135.52, 34.60], // 平野区南東
    [135.56, 34.68], // 生野区東
    [135.59, 34.75], // 鶴見区北東
    [135.52, 34.78], // 旭区北
    [135.44, 34.75], // 西淀川区北西
    [135.40, 34.68], // 此花区西
    [135.43, 34.58],
  ];

  return {
    tokyo23: [[tokyo23Ring]],
    tokyo: [[tokyoRing]],
    nagoya: [[nagoyaRing]],
    osaka: [[osakaRing]],
  };
}

async function tryFetchAll(): Promise<Record<'tokyo23' | 'tokyo' | 'nagoya' | 'osaka', MultiPolygon> | null> {
  try {
    console.log('東京23区のポリゴンを取得中...');
    const tokyo23Rings = await fetchCityOuterRings('13', TOKYO23_CODES);
    if (tokyo23Rings.length === 0) throw new Error('tokyo23: no rings fetched');

    console.log('名古屋市のポリゴンを取得中...');
    const nagoyaRings = await fetchCityOuterRings('23', NAGOYA_CODES);
    if (nagoyaRings.length === 0) throw new Error('nagoya: no rings fetched');

    console.log('大阪市のポリゴンを取得中...');
    const osakaRings = await fetchCityOuterRings('27', OSAKA_CODES);
    if (osakaRings.length === 0) throw new Error('osaka: no rings fetched');

    console.log('東京都のポリゴンを取得中(都道府県境界)...');
    const tokyoPrefRings = await fetchPrefectureOuterRings(13);
    if (tokyoPrefRings.length === 0) throw new Error('tokyo: no rings fetched');

    // 簡略化許容誤差（度）。都道府県レベルはやや粗め、市区レベルはやや細かめ。
    const CITY_EPSILON = 0.0015;
    const PREF_EPSILON = 0.003;

    return {
      tokyo23: buildMultiPolygon(tokyo23Rings, CITY_EPSILON),
      tokyo: buildMultiPolygon(tokyoPrefRings, PREF_EPSILON),
      nagoya: buildMultiPolygon(nagoyaRings, CITY_EPSILON),
      osaka: buildMultiPolygon(osakaRings, CITY_EPSILON),
    };
  } catch (err) {
    console.warn(`オープンデータ取得に失敗しました: ${(err as Error).message}`);
    return null;
  }
}

// ---- 検証用: ray casting によるポイントインポリゴン判定（このスクリプト内で自己検証するため簡易実装） ----
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInMultiPolygon(lon: number, lat: number, mp: MultiPolygon): boolean {
  for (const polygon of mp) {
    // polygon[0] = 外環（穴は生成しないため無視）
    if (pointInRing(lon, lat, polygon[0])) return true;
  }
  return false;
}

function validate(areas: Record<'tokyo23' | 'tokyo' | 'nagoya' | 'osaka', MultiPolygon>): void {
  const checks: { name: string; lon: number; lat: number; expect: Partial<Record<'tokyo23' | 'tokyo' | 'nagoya' | 'osaka', boolean>> }[] = [
    { name: '東京駅', lon: 139.767, lat: 35.681, expect: { tokyo23: true, tokyo: true } },
    { name: '新宿', lon: 139.700, lat: 35.690, expect: { tokyo23: true, tokyo: true } },
    { name: '吉祥寺', lon: 139.580, lat: 35.703, expect: { tokyo23: false, tokyo: true } },
    { name: '横浜', lon: 139.622, lat: 35.466, expect: { tokyo: false } },
    { name: '名古屋駅', lon: 136.882, lat: 35.171, expect: { nagoya: true } },
    { name: '大阪駅', lon: 135.495, lat: 34.702, expect: { osaka: true } },
    { name: '京都駅', lon: 135.759, lat: 34.985, expect: { osaka: false } },
  ];

  let allOk = true;
  for (const check of checks) {
    for (const [areaId, expected] of Object.entries(check.expect)) {
      const actual = pointInMultiPolygon(check.lon, check.lat, areas[areaId as keyof typeof areas]);
      const ok = actual === expected;
      if (!ok) allOk = false;
      console.log(
        `  [${ok ? 'OK' : 'NG'}] ${check.name} in ${areaId}: expected=${expected}, actual=${actual}`
      );
    }
  }
  if (!allOk) {
    throw new Error('areas.json の検証に失敗しました（上記 NG 項目を確認してください）');
  }
  console.log('検証: 全チェック OK');
}

async function main() {
  let source: 'opendata' | 'fallback';
  let areas = await tryFetchAll();
  if (areas) {
    source = 'opendata';
  } else {
    console.log('フォールバック: 手作りの粗いポリゴンを使用します。');
    areas = fallbackAreas();
    source = 'fallback';
  }

  console.log('検証中...');
  try {
    validate(areas);
  } catch (err) {
    if (source === 'opendata') {
      console.warn(`オープンデータでの検証に失敗したため、フォールバックに切り替えます: ${(err as Error).message}`);
      areas = fallbackAreas();
      source = 'fallback';
      validate(areas);
    } else {
      throw err;
    }
  }

  const output = {
    source,
    generatedAt: new Date().toISOString(),
    areas: {
      tokyo23: areas.tokyo23,
      tokyo: areas.tokyo,
      nagoya: areas.nagoya,
      osaka: areas.osaka,
      // japan はポリゴン不要（全駅対象）
    },
  };

  const json = JSON.stringify(output);
  writeFileSync(OUTPUT_PATH, json);

  const sizeKb = Buffer.byteLength(json) / 1024;
  console.log(`areas.json を生成しました: ${OUTPUT_PATH}`);
  console.log(`  データ源: ${source}`);
  console.log(`  サイズ: ${sizeKb.toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
