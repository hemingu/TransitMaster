/**
 * 国土数値情報「駅別乗降客数データ」(S12) の解析と、Mini Tokyo 3D の駅レコードへの対応付け（純粋関数群）。
 * ファイルI/Oは build-mt3d-network.ts 側が担当する。
 *
 * S12 の GeoJSON は1路線×1駅=1レコード（LineString = ホームの線形）で、属性は
 *  S12_001 駅名 / S12_002 運営会社 / S12_003 路線名 /
 *  2011〜2024年の4項目ずつ（S12_006〜S12_061）: 重複コード・データ有無コード・備考・乗降客数（人/日）。
 * 重複コード 1 = 本体、2 = 他レコードに含めて計上済み（値は0）。データ有無コード 1 = 有、2 = 無、3 = 非公開。
 */

/** 解析済みの S12 駅レコード（乗降客数が有効なもののみ）。 */
export interface S12Station {
  /** 駅名（原文）。 */
  name: string;
  /** 運営会社名（原文。例: 東日本旅客鉄道）。 */
  company: string;
  /** 路線名（原文）。 */
  line: string;
  /** ホームの線形（[lon, lat] の並び）。 */
  coords: [number, number][];
  /** 1日あたり乗降客数（採用した年の値）。 */
  ridership: number;
  /** 採用した年（西暦）。 */
  year: number;
}

/** 年ごとの属性は 2011 年の S12_006 から4項目ずつ並ぶ。 */
const FIRST_YEAR = 2011;
const LAST_YEAR = 2024;
const FIELDS_PER_YEAR = 4;
const FIRST_YEAR_FIELD = 6; // 重複コード（S12_006）

function field(props: Record<string, unknown>, n: number): unknown {
  return props[`S12_${String(n).padStart(3, '0')}`];
}

/**
 * 1レコード分の属性から、最新の「有効な」年の乗降客数を取り出す。
 * 有効 = 重複コード1（本体）・データ有無コード1（データ有）・乗降客数が正の数。
 * 最新年が欠測・非公開・0 のときは前の年へフォールバックする。有効な年が無ければ null。
 */
export function latestValidRidership(
  props: Record<string, unknown>
): { ridership: number; year: number } | null {
  for (let year = LAST_YEAR; year >= FIRST_YEAR; year--) {
    const base = FIRST_YEAR_FIELD + (year - FIRST_YEAR) * FIELDS_PER_YEAR;
    const dup = field(props, base);
    const exist = field(props, base + 1);
    const value = field(props, base + 3);
    if (dup === 1 && exist === 1 && typeof value === 'number' && value > 0) {
      return { ridership: value, year };
    }
  }
  return null;
}

/** S12 の GeoJSON（FeatureCollection）を解析し、乗降客数が有効なレコードだけを返す。想定外の形のものは読み飛ばす。 */
export function parseS12(geojson: unknown): S12Station[] {
  const features = (geojson as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: S12Station[] = [];
  for (const f of features) {
    const props = f?.properties as Record<string, unknown> | undefined;
    const geom = f?.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (!props || !geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) continue;
    const name = props.S12_001;
    const company = props.S12_002;
    const line = props.S12_003;
    if (typeof name !== 'string' || typeof company !== 'string' || typeof line !== 'string') continue;
    const coords = (geom.coordinates as unknown[]).filter(
      (c): c is [number, number] =>
        Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number'
    );
    if (coords.length === 0) continue;
    const v = latestValidRidership(props);
    if (!v) continue;
    out.push({ name, company, line, coords, ridership: v.ridership, year: v.year });
  }
  return out;
}

/**
 * 駅名の正規化（S12 と MT3D の表記ゆれを吸収する）。
 * 括弧書き（〈…〉・(…)・（…））を除去、末尾の「駅」を除去、全角英数→半角、ヶ/ヵ→ケ、空白除去。
 */
export function normalizeStationName(name: string): string {
  let s = name.normalize('NFKC'); // 全角英数・括弧を半角化
  s = s.replace(/[〈<(][^〉>)]*[〉>)]/g, '');
  s = s.replace(/[ヶヵ]/g, 'ケ').replace(/\s+/g, '');
  if (s.length > 1) s = s.replace(/駅$/, '');
  return s;
}

/** S12 の運営会社名 → MT3D 側の事業者名（OPERATOR_NAMES の値）。表記が同じものは載せない。 */
export const S12_OPERATOR_ALIASES: Readonly<Record<string, string>> = {
  東日本旅客鉄道: 'JR東日本',
  東海旅客鉄道: 'JR東海',
  東京地下鉄: '東京メトロ',
  東京都: '都営地下鉄',
  横浜市: '横浜市営地下鉄',
  京浜急行電鉄: '京急電鉄',
  小田急箱根: '箱根登山鉄道',
  小湊鐵道: '小湊鉄道',
  富士山麓電気鉄道: '富士急行',
  銚子電気鉄道: '銚子電気鉄道',
};

/** S12 の運営会社名を MT3D 側の事業者名に寄せる。 */
export function s12OperatorToMt3d(company: string): string {
  return S12_OPERATOR_ALIASES[company] ?? company;
}

/** 対応付けの対象となる MT3D 側の駅レコード（最小限）。 */
export interface RidershipTarget {
  name: string;
  lon: number;
  lat: number;
  /** 事業者名（Line.company）。 */
  company: string;
}

/** 駅レコードとホーム線形の最大距離（メートル）。 */
export const MATCH_MAX_DISTANCE_M = 500;

/** 同一事業者・同一駅名・同一乗降客数の S12 レコードを同一駅の重複掲載とみなす距離（メートル）。 */
const DEDUPE_DISTANCE_M = 500;

const M_PER_DEG = 111000;

/** 点(lon,lat)から折れ線までの最短距離（メートル、局所平面近似）。 */
export function distanceToPolylineM(
  lon: number,
  lat: number,
  coords: [number, number][]
): number {
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const ky = M_PER_DEG;
  const px = lon * kx;
  const py = lat * ky;
  let best = Number.POSITIVE_INFINITY;
  const segCount = Math.max(1, coords.length - 1);
  for (let i = 0; i < segCount; i++) {
    const [ax, ay] = [coords[i][0] * kx, coords[i][1] * ky];
    const [bx, by] = coords.length > 1 ? [coords[i + 1][0] * kx, coords[i + 1][1] * ky] : [ax, ay];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

export interface RidershipMatchResult {
  /** targets と同じ長さ。対応づけた S12 レコードの乗降客数の合計（対応なしは undefined）。 */
  ridership: (number | undefined)[];
  /** 対応づけた（重複除去後の）S12 レコード数。 */
  matched: number;
  /** 重複掲載として除いた S12 レコード数。 */
  deduped: number;
  /** 対応先が見つからなかった S12 レコード。 */
  unmatched: S12Station[];
}

/**
 * S12 レコードを MT3D の駅レコードに対応づけ、駅レコードごとの乗降客数（人/日）を求める。
 *  1. 同一事業者・同一正規化駅名・同一乗降客数で近接するレコードは重複掲載として1件に数える。
 *  2. 正規化した駅名が一致し、ホーム線形との距離が MATCH_MAX_DISTANCE_M 以内の駅レコードが候補。
 *  3. 候補のうち同一事業者（S12_OPERATOR_ALIASES で寄せた名前が一致）を優先し、その中で最も近いものを選ぶ。
 *  4. 選んだ駅レコードに乗降客数を加算する（1つの S12 レコードは1つの駅レコードにのみ対応づける）。
 * 乗換グループの合計は、呼び出し側で同グループの駅レコードの値を足して得る。
 */
export function matchRidership(targets: RidershipTarget[], records: S12Station[]): RidershipMatchResult {
  const byName = new Map<string, number[]>();
  targets.forEach((t, i) => {
    const key = normalizeStationName(t.name);
    const arr = byName.get(key);
    if (arr) arr.push(i);
    else byName.set(key, [i]);
  });

  const ridership: (number | undefined)[] = new Array(targets.length).fill(undefined);
  const seen = new Map<string, { lon: number; lat: number }[]>();
  const unmatched: S12Station[] = [];
  let matched = 0;
  let deduped = 0;

  for (const rec of records) {
    const nameKey = normalizeStationName(rec.name);
    const op = s12OperatorToMt3d(rec.company);
    const c = rec.coords[Math.floor(rec.coords.length / 2)];

    const dedupeKey = `${op}\u0000${nameKey}\u0000${rec.ridership}`;
    const prev = seen.get(dedupeKey) ?? [];
    if (prev.some((p) => distanceToPolylineM(p.lon, p.lat, rec.coords) <= DEDUPE_DISTANCE_M)) {
      deduped++;
      continue;
    }
    prev.push({ lon: c[0], lat: c[1] });
    seen.set(dedupeKey, prev);

    let best = -1;
    let bestSame = false;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const i of byName.get(nameKey) ?? []) {
      const d = distanceToPolylineM(targets[i].lon, targets[i].lat, rec.coords);
      if (d > MATCH_MAX_DISTANCE_M) continue;
      const same = targets[i].company === op;
      if ((same && !bestSame) || (same === bestSame && d < bestDist)) {
        best = i;
        bestSame = same;
        bestDist = d;
      }
    }
    if (best < 0) {
      unmatched.push(rec);
      continue;
    }
    ridership[best] = (ridership[best] ?? 0) + rec.ridership;
    matched++;
  }
  return { ridership, matched, deduped, unmatched };
}
