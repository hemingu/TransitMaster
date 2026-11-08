import { describe, expect, it } from 'vitest';
import {
  buildMt3dNetwork,
  type Mt3dInput,
  type Mt3dRailway,
  type Mt3dStation,
  type Mt3dTrain,
  type TransferGroupOverrides,
} from '../scripts/buildMt3dNetwork.ts';
import { formatRouteLegs, mergeThroughLegsByName } from '../src/lib/game.ts';
import { searchRoute } from '../src/lib/raptor.ts';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { LINK_SEGMENT, type Network } from '../src/lib/types.ts';

/** 簡易入力: railways = [id, 路線名, [駅名...]]、各駅は経度を 0.01 度ずつずらして並べる（同名は同座標）。 */
type RW = [string, string, string[]];
function mk(rws: RW[], trains: [string, string, [string, string][]][], overrides?: TransferGroupOverrides): Mt3dInput {
  const coord = new Map<string, number>();
  const railways: Mt3dRailway[] = [];
  const stations: Mt3dStation[] = [];
  for (const [id, name, sts] of rws) {
    railways.push({ id, title: { ja: name, en: id }, stations: sts.map((s) => `${id}.${s}`) });
    for (const s of sts) {
      const key = s.replace(/[(〈].*$/, ''); // 表記ゆれ違いは同座標にする
      if (!coord.has(key)) coord.set(key, 139 + coord.size * 0.01);
      stations.push({ id: `${id}.${s}`, railway: id, coord: [coord.get(key)!, 35.6], title: { ja: s, en: s } });
    }
  }
  const ts: Mt3dTrain[] = trains.map(([tid, r, stops]) => ({
    id: tid,
    r,
    y: 'Test.Local',
    tt: stops.map(([s, t]) => ({ s: `${r}.${s}`, a: t, d: t })),
  }));
  return { railways, stations, stationGroups: [], trainTypes: [{ id: 'Test.Local' }], trains: ts, overrides };
}
/** 列車の nt/pt を設定する。 */
function chain(input: Mt3dInput, ids: string[]): void {
  ids.forEach((id, i) => {
    const t = input.trains.find((x) => x.id === id)!;
    if (i + 1 < ids.length) t.nt = [ids[i + 1]];
    if (i > 0) t.pt = [ids[i - 1]];
  });
}
const lineIdx = (n: Network, name: string, company?: string) =>
  n.lines.findIndex((l) => l.name === name && (company === undefined || l.company === company));
const stn = (n: Network, line: number, name: string) => n.stations.findIndex((s) => s.line === line && s.name === name);

describe('同名・同事業者の路線の統合', () => {
  const input = mk(
    [
      ['Tobu.X1', 'テスト線', ['a', 'b']],
      ['Tobu.X2', 'テスト線', ['b', 'c']],
    ],
    [
      ['T1', 'Tobu.X1', [['a', '06:00'], ['b', '06:10']]],
      ['T2', 'Tobu.X2', [['b', '06:12'], ['c', '06:20']]],
    ]
  );
  chain(input, ['T1', 'T2']);
  const net = buildMt3dNetwork(input).network;
  const L = lineIdx(net, 'テスト線');

  it('1つの路線になる', () => {
    expect(net.lines.filter((l) => l.name === 'テスト線')).toHaveLength(1);
    expect(net.stations.every((s) => s.line === L)).toBe(true);
    // 直通リンクがあり、その両端は同じ路線のレコード
    expect(net.patterns.some((p) => p.segLine.includes(LINK_SEGMENT))).toBe(true);
  });

  it('模範解答は直通リンクで leg を分割しない', () => {
    const it1 = searchRoute(net, stn(net, L, 'a'), stn(net, L, 'c'), 'time')!;
    expect(it1.legs).toHaveLength(1);
    expect(it1.legs[0]).toMatchObject({ line: L, rideSec: 20 * 60 });
    expect(it1.transfers).toBe(0);
  });

  it('統合路線上の leg は元の railway をまたいで有効', () => {
    const a = stn(net, L, 'a');
    const c = stn(net, L, 'c');
    expect(validateRoute(net, a, c, [{ line: L, from: a, to: c }]).valid).toBe(true);
    expect(evaluateRoute(net, [{ line: L, from: a, to: c }], 'transfers')).toMatchObject({ transfers: 0, totalSec: 20 * 60 });
  });

  it('事業者が違えば統合しない', () => {
    const n2 = buildMt3dNetwork(
      mk(
        [
          ['Tobu.X1', 'テスト線', ['a', 'b']],
          ['Seibu.X2', 'テスト線', ['b', 'c']],
        ],
        [
          ['T1', 'Tobu.X1', [['a', '06:00'], ['b', '06:10']]],
          ['T2', 'Seibu.X2', [['b', '06:12'], ['c', '06:20']]],
        ]
      )
    ).network;
    expect(n2.lines.filter((l) => l.name === 'テスト線')).toHaveLength(2);
  });
});

describe('直通で路線名が同じ区間の表示統合', () => {
  const input = mk(
    [
      ['JR-East.Tokaido', '東海道線', ['a', 'b']],
      ['JR-Central.Tokaido', '東海道線', ['b', 'c']],
      ['JR-East.Other', '別線', ['c', 'd']],
    ],
    [
      ['T1', 'JR-East.Tokaido', [['a', '06:00'], ['b', '06:10']]],
      ['T2', 'JR-Central.Tokaido', [['b', '06:12'], ['c', '06:20']]],
      ['T3', 'JR-East.Other', [['c', '06:30'], ['d', '06:40']]],
    ]
  );
  chain(input, ['T1', 'T2']);
  const net = buildMt3dNetwork(input).network;

  it('直通の同名区間は1区間にまとめ、乗車時間を合算する', () => {
    const it1 = searchRoute(net, stn(net, lineIdx(net, '東海道線', 'JR東日本'), 'a'), stn(net, lineIdx(net, '東海道線', 'JR東海'), 'c'), 'time')!;
    expect(it1.legs).toHaveLength(2);
    expect(it1.legs[1].through).toBe(true);
    const merged = mergeThroughLegsByName(net, it1.legs);
    expect(merged).toHaveLength(1);
    expect(merged[0].rideSec).toBe(20 * 60);
    expect(formatRouteLegs(net, it1.legs)).toBe('東海道線（JR東日本・JR東海） a→c');
  });

  it('乗換をはさむ区間や路線名が違う区間はまとめない', () => {
    const e = lineIdx(net, '東海道線', 'JR東日本');
    const c = lineIdx(net, '東海道線', 'JR東海');
    const o = lineIdx(net, '別線');
    const legs = [
      { line: e, from: stn(net, e, 'a'), to: stn(net, e, 'b') },
      { line: c, from: stn(net, c, 'b'), to: stn(net, c, 'c') }, // through なし = 乗換
      { line: o, from: stn(net, o, 'c'), to: stn(net, o, 'd'), through: true },
    ];
    expect(mergeThroughLegsByName(net, legs)).toHaveLength(3);
  });
});

describe('区間の路線の付け替え（segmentLineOverrides）', () => {
  const rws: RW[] = [
    ['Keisei.NSA', '成田スカイアクセス線', ['u', 'm', 't', 'x']],
    ['Keisei.Main', '京成本線', ['u', 'm', 't', 'y']],
  ];
  const trains: [string, string, [string, string][]][] = [
    ['N1', 'Keisei.NSA', [['u', '06:00'], ['m', '06:05'], ['t', '06:10'], ['x', '06:20']]],
    ['M1', 'Keisei.Main', [['m', '07:00'], ['t', '07:05'], ['y', '07:10']]],
  ];
  const ov: TransferGroupOverrides = {
    segmentLineOverrides: [{ railway: 'Keisei.NSA', from: 'u', to: 't', line: 'Keisei.Main' }],
  };
  const net = buildMt3dNetwork(mk(rws, trains, ov)).network;
  const main = lineIdx(net, '京成本線');
  const nsa = lineIdx(net, '成田スカイアクセス線');

  it('範囲内の区間が付け替え先の路線・レコードになる', () => {
    const p = net.patterns.find((x) => x.stops.length > 4)!;
    expect(p.segLine.map((l) => (l === LINK_SEGMENT ? 'L' : net.lines[l].name))).toEqual([
      '京成本線',
      '京成本線',
      'L',
      '成田スカイアクセス線',
    ]);
    expect(p.stops.slice(0, 3).every((s) => net.stations[s].line === main)).toBe(true);
    // 範囲内にしか現れなかった付け替え元のレコード（u, m）は残らない
    expect(net.stations.filter((s) => s.line === nsa).map((s) => s.name).sort()).toEqual(['t', 'x']);
  });

  it('付け替え先 + 元路線の継続は乗換なし', () => {
    const legs = [
      { line: main, from: stn(net, main, 'm'), to: stn(net, main, 't') },
      { line: nsa, from: stn(net, nsa, 't'), to: stn(net, nsa, 'x') },
    ];
    expect(validateRoute(net, legs[0].from, legs[1].to, legs).valid).toBe(true);
    expect(evaluateRoute(net, legs, 'transfers').transfers).toBe(0);
    const it1 = searchRoute(net, stn(net, main, 'u'), stn(net, nsa, 'x'), 'time')!;
    expect(it1.transfers).toBe(0);
    expect(it1.legs.map((l) => net.lines[l.line].name)).toEqual(['京成本線', '成田スカイアクセス線']);
  });

  it('存在しない railway・駅を参照するとビルドが失敗する', () => {
    const bad = (o: TransferGroupOverrides) => () => buildMt3dNetwork(mk(rws, trains, o));
    expect(bad({ segmentLineOverrides: [{ railway: 'No.Such', from: 'u', to: 't', line: 'Keisei.Main' }] })).toThrow(/No\.Such/);
    expect(bad({ segmentLineOverrides: [{ railway: 'Keisei.NSA', from: 'zz', to: 't', line: 'Keisei.Main' }] })).toThrow(/zz/);
    // x は Keisei.Main に同名レコードが無い
    expect(bad({ segmentLineOverrides: [{ railway: 'Keisei.NSA', from: 'u', to: 'x', line: 'Keisei.Main' }] })).toThrow(/x/);
  });
});

describe('駅名の上書き（stationNameOverrides）', () => {
  const rws: RW[] = [
    ['Toei.A', 'A線', ['押上(スカイツリー前)', 'p']],
    ['Tobu.B', 'B線', ['押上〈スカイツリー前〉', 'q']],
  ];
  const trains: [string, string, [string, string][]][] = [
    ['A1', 'Toei.A', [['押上(スカイツリー前)', '06:00'], ['p', '06:05']]],
    ['B1', 'Tobu.B', [['押上〈スカイツリー前〉', '06:00'], ['q', '06:05']]],
  ];

  it('上書き後の名前になり、同名なので同じ乗換グループにもなる', () => {
    const net = buildMt3dNetwork(
      mk(rws, trains, { stationNameOverrides: { '押上(スカイツリー前)': '押上', '押上〈スカイツリー前〉': '押上' } })
    ).network;
    const o = net.stations.filter((s) => s.name === '押上');
    expect(o).toHaveLength(2);
    expect(new Set(o.map((s) => s.group)).size).toBe(1);
    expect(net.stations.some((s) => s.name.startsWith('押上('))).toBe(false);
  });

  it('該当する駅が無ければビルドが失敗する', () => {
    expect(() => buildMt3dNetwork(mk(rws, trains, { stationNameOverrides: { 存在しない駅: 'x' } }))).toThrow(/存在しない駅/);
  });
});
