import { describe, expect, it } from 'vitest';
import {
  distanceToPolylineM,
  latestValidRidership,
  matchRidership,
  normalizeStationName,
  parseS12,
  type S12Station,
} from '../scripts/s12Ridership.ts';

/** 2011〜2024年の属性（重複コード, データ有無, 備考, 乗降客数）を持つ S12 属性を作る。years: 年 -> [dup, exist, value] */
function props(years: Record<number, [number, number, number | null]>, extra: Record<string, unknown> = {}) {
  const p: Record<string, unknown> = { S12_001: '新宿', S12_002: '京王電鉄', S12_003: '京王線', ...extra };
  for (let year = 2011; year <= 2024; year++) {
    const base = 6 + (year - 2011) * 4;
    const [dup, exist, value] = years[year] ?? [1, 2, 0];
    p[`S12_${String(base).padStart(3, '0')}`] = dup;
    p[`S12_${String(base + 1).padStart(3, '0')}`] = exist;
    p[`S12_${String(base + 2).padStart(3, '0')}`] = null;
    p[`S12_${String(base + 3).padStart(3, '0')}`] = value;
  }
  return p;
}

describe('latestValidRidership', () => {
  it('最新年が有効ならその値', () => {
    expect(latestValidRidership(props({ 2023: [1, 1, 100], 2024: [1, 1, 200] }))).toEqual({ ridership: 200, year: 2024 });
  });
  it('最新年が欠測・非公開・0・重複扱いなら前の年にフォールバック', () => {
    expect(latestValidRidership(props({ 2022: [1, 1, 150], 2023: [1, 3, 0], 2024: [1, 2, 0] }))).toEqual({ ridership: 150, year: 2022 });
    expect(latestValidRidership(props({ 2022: [1, 1, 150], 2024: [1, 1, 0] }))).toEqual({ ridership: 150, year: 2022 });
    expect(latestValidRidership(props({ 2022: [1, 1, 150], 2024: [2, 1, 999] }))).toEqual({ ridership: 150, year: 2022 });
  });
  it('有効な年が無ければ null', () => {
    expect(latestValidRidership(props({}))).toBeNull();
  });
});

describe('parseS12', () => {
  it('有効なレコードだけを返す（LineString 以外・値なしは除外）', () => {
    const geo = {
      features: [
        { properties: props({ 2024: [1, 1, 500] }), geometry: { type: 'LineString', coordinates: [[139.7, 35.69], [139.71, 35.69]] } },
        { properties: props({ 2024: [1, 2, 0] }), geometry: { type: 'LineString', coordinates: [[139.7, 35.69]] } },
        { properties: props({ 2024: [1, 1, 500] }), geometry: { type: 'Point', coordinates: [139.7, 35.69] } },
        { properties: props({ 2024: [1, 1, 500] }), geometry: null },
      ],
    };
    const recs = parseS12(geo);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ name: '新宿', company: '京王電鉄', ridership: 500, year: 2024 });
    expect(parseS12(null)).toEqual([]);
  });
});

describe('normalizeStationName', () => {
  it('駅・括弧書き・全角英数・ヶ/ケを正規化する', () => {
    expect(normalizeStationName('新宿駅')).toBe('新宿');
    expect(normalizeStationName('押上〈スカイツリー前〉')).toBe('押上');
    expect(normalizeStationName('押上(スカイツリー前)')).toBe('押上');
    expect(normalizeStationName('押上（スカイツリー前）')).toBe('押上');
    expect(normalizeStationName('茅ヶ崎')).toBe(normalizeStationName('茅ケ崎'));
    expect(normalizeStationName('北綾瀬')).toBe('北綾瀬');
    expect(normalizeStationName('西５丁目')).toBe(normalizeStationName('西5丁目'));
  });
});

describe('distanceToPolylineM', () => {
  it('折れ線上は0、離れた点は概ね距離を返す', () => {
    const line: [number, number][] = [[139.7, 35.69], [139.71, 35.69]];
    expect(distanceToPolylineM(139.705, 35.69, line)).toBeLessThan(1);
    const d = distanceToPolylineM(139.705, 35.69 + 0.001, line);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('matchRidership', () => {
  const rec = (over: Partial<S12Station>): S12Station => ({
    name: '新宿',
    company: '東日本旅客鉄道',
    line: '中央線',
    coords: [[139.7005, 35.6893], [139.7006, 35.6899]],
    ridership: 1000,
    year: 2024,
    ...over,
  });
  const targets = [
    { name: '新宿', lon: 139.7005, lat: 35.6895, company: 'JR東日本' },
    { name: '新宿', lon: 139.6992, lat: 35.6904, company: '京王電鉄' },
    { name: '新宿駅', lon: 139.7, lat: 35.69, company: '東京メトロ' },
    { name: '渋谷', lon: 139.7, lat: 35.658, company: 'JR東日本' },
  ];

  it('同名・近接の駅レコードのうち同一事業者（別名対応）を優先して加算する', () => {
    const res = matchRidership(targets, [rec({}), rec({ company: '京王電鉄', ridership: 500, coords: [[139.6992, 35.6905], [139.6993, 35.6895]] })]);
    expect(res.ridership).toEqual([1000, 500, undefined, undefined]);
    expect(res.matched).toBe(2);
  });

  it('同じ事業者・駅名・値が複数路線で重複掲載されていたら1件に数える', () => {
    const res = matchRidership(targets, [rec({ line: '中央線' }), rec({ line: '山手線' })]);
    expect(res.ridership[0]).toBe(1000);
    expect(res.deduped).toBe(1);
  });

  it('値が異なる同一事業者・同駅の別レコードは合算する', () => {
    const res = matchRidership(targets, [rec({ ridership: 1000 }), rec({ ridership: 300, line: '埼京線' })]);
    expect(res.ridership[0]).toBe(1300);
  });

  it('距離が離れている・名前が違うレコードは未対応', () => {
    const far = rec({ name: '渋谷', coords: [[139.8, 35.8], [139.8, 35.81]] });
    const other = rec({ name: '存在しない駅' });
    const res = matchRidership(targets, [far, other]);
    expect(res.matched).toBe(0);
    expect(res.unmatched).toHaveLength(2);
  });

  it('同一事業者が無くても名前と距離が合えば他事業者の駅レコードに対応づける', () => {
    const res = matchRidership(targets, [rec({ company: '未知の鉄道', ridership: 70 })]);
    // 距離が最も近い駅レコード（ホーム線形上に近い JR東日本の新宿）に付く
    expect(res.ridership[0]).toBe(70);
  });
});
