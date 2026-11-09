import { describe, expect, it } from 'vitest';
import { buildMt3dNetwork, type TransferGroupOverrides } from '../scripts/buildMt3dNetwork.ts';
import { generateQuestion } from '../src/lib/question.ts';
import { searchRoute } from '../src/lib/raptor.ts';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { playerGroupOf } from '../src/lib/networkIndex.ts';
import { findLine, findStation, miniMt3dInput } from './fixtures/miniMt3d.ts';

function build(overrides: TransferGroupOverrides) {
  const input = miniMt3dInput();
  input.overrides = overrides;
  return buildMt3dNetwork(input).network;
}

const groupsOf = (net: ReturnType<typeof build>, name: string) =>
  new Set(net.stations.filter((s) => s.name === name).map((s) => s.group));

describe('乗換グループの手動調整（overrides）', () => {
  const base = build({});
  const baseGroupCount = new Set(base.stations.map((s) => s.group)).size;
  // フィクスチャの新宿グループ = 新宿 / 新宿三丁目 / 新宿西口
  const SHINJUKU = ['新宿', '新宿三丁目', '新宿西口'];

  it('split: 挙げた駅名ごとに別グループになる', () => {
    const net = build({ split: [SHINJUKU] });
    expect(new Set(net.stations.map((s) => s.group)).size).toBe(baseGroupCount + 2);
    const g = SHINJUKU.map((n) => [...groupsOf(net, n)]);
    expect(g.every((x) => x.length === 1)).toBe(true);
    expect(new Set(g.map((x) => x[0])).size).toBe(3);
  });

  it('split: 駅名の挙げ漏れはエラー', () => {
    expect(() => build({ split: [['新宿', '新宿三丁目']] })).toThrow(/新宿西口/);
  });

  it('該当グループが0件ならエラー', () => {
    expect(() => build({ exclude: [['存在しない駅']] })).toThrow(/0 件/);
  });

  it('該当グループが複数ならエラー', () => {
    // 同名駅が複数グループに跨っていなくても、東京など単独の名前では1件。ここでは分割後の曖昧さを再現できないため新宿を2回 split して検証
    expect(() => build({ split: [SHINJUKU, SHINJUKU] })).toThrow();
  });

  it('merge: 2グループを統合できる', () => {
    const net = build({ merge: [[['東京'], ['上野']]] });
    expect(new Set(net.stations.map((s) => s.group)).size).toBe(baseGroupCount - 1);
    expect([...groupsOf(net, '東京')][0]).toBe([...groupsOf(net, '上野')][0]);
  });

  it('excludeNames: その駅名のレコードだけ noQuestion が付き、同じグループの他の駅名には付かない', () => {
    const net = build({ excludeNames: ['新宿西口'] });
    for (const st of net.stations) {
      if (st.name === '新宿西口') expect(st.noQuestion).toBe(true);
      else expect(st.noQuestion).toBeUndefined();
    }
    // グループ自体は変わらない（途中の乗換は従来どおり可能）
    expect(groupsOf(net, '新宿西口')).toEqual(groupsOf(net, '新宿'));
  });

  it('excludeNames: 該当駅が無ければエラー', () => {
    expect(() => build({ excludeNames: ['存在しない駅'] })).toThrow(/存在しない駅/);
  });

  it('exclude: グループ内の全駅に noQuestion が付き、他は付かない', () => {
    const net = build({ exclude: [['新宿三丁目']] });
    for (const s of net.stations) {
      expect(s.noQuestion === true).toBe(SHINJUKU.includes(s.name));
    }
    expect(base.stations.some((s) => s.noQuestion)).toBe(false);
  });

  it('generateQuestion は noQuestion の駅を出発・到着にしない', () => {
    const net = build({ exclude: [['新宿三丁目']] });
    const all = net.stations.map((_, i) => i);
    let produced = 0;
    for (let i = 0; i < 100; i++) {
      const q = generateQuestion(net, all, { minTransfers: 0, rng: Math.random });
      if (!q) continue;
      produced++;
      expect(net.stations[q.origin].noQuestion).toBeUndefined();
      expect(net.stations[q.destination].noQuestion).toBeUndefined();
    }
    expect(produced).toBeGreaterThan(0);
  });

  it('候補が noQuestion だけなら null', () => {
    const net = build({ exclude: [['新宿三丁目']] });
    const only = net.stations.flatMap((s, i) => (s.noQuestion ? [i] : []));
    expect(generateQuestion(net, only, { minTransfers: 0 })).toBeNull();
  });
});

describe('playerOnlyMerge（プレイヤーの解答でだけ使える乗換駅）', () => {
  const net = build({ playerOnlyMerge: [[['東京'], ['池袋']]] });
  const plain = build({});
  const st = (line: string, name: string) => findStation(net, line, name);
  const ln = (name: string) => findLine(net, name);
  const shinagawa = st('山手線', '品川');
  const tokyo = st('山手線', '東京');
  const ikebukuro = st('副都心線', '池袋');
  const shinjuku3 = st('副都心線', '新宿三丁目');
  const leg = (line: string, from: number, to: number) => ({ line: ln(line), from, to });

  it('group は統合されず、片方の駅にだけ playerGroup が付く', () => {
    expect(net.stations[tokyo].group).not.toBe(net.stations[ikebukuro].group);
    expect(playerGroupOf(net, tokyo)).toBe(playerGroupOf(net, ikebukuro));
    expect(plain.stations.some((s) => s.playerGroup !== undefined)).toBe(false);
    expect(net.stations.filter((s) => s.playerGroup !== undefined).every((s) => s.group !== s.playerGroup)).toBe(true);
  });

  it('途中: 東京で降りて池袋から乗る経路は有効で +transferSec・乗換+1（結ばなければ bad-transfer）', () => {
    const legs = [leg('山手線', shinagawa, tokyo), leg('副都心線', ikebukuro, shinjuku3)];
    expect(validateRoute(net, shinagawa, shinjuku3, legs)).toEqual({ valid: true });
    const e = evaluateRoute(net, legs, 'time');
    const ride = evaluateRoute(net, [legs[0]], 'time').rideSec + evaluateRoute(net, [legs[1]], 'time').rideSec;
    expect(e.transfers).toBe(1);
    expect(e.totalSec).toBe(ride + net.transferSec);
    const plainLegs = [
      { ...legs[0], from: findStation(plain, '山手線', '品川'), to: findStation(plain, '山手線', '東京') },
      { ...legs[1], from: findStation(plain, '副都心線', '池袋'), to: findStation(plain, '副都心線', '新宿三丁目') },
    ];
    expect(validateRoute(plain, plainLegs[0].from, plainLegs[1].to, plainLegs).reason).toBe('bad-transfer');
  });

  it('出発・到着: 出発が東京でも池袋から乗れ、到着が池袋でも東京で降りてよい', () => {
    const l2 = [leg('副都心線', ikebukuro, shinjuku3)];
    expect(validateRoute(net, tokyo, shinjuku3, l2)).toEqual({ valid: true });
    const l3 = [leg('山手線', shinagawa, tokyo)];
    expect(validateRoute(net, shinagawa, ikebukuro, l3)).toEqual({ valid: true });
    expect(validateRoute(plain, shinagawa, findStation(plain, '副都心線', '池袋'), [l3[0]]).reason).toBe('wrong-destination');
  });

  it('模範解答は結びを使わず、評価が模範と一致する', () => {
    for (const mode of ['time', 'transfers'] as const) {
      const it1 = searchRoute(net, shinagawa, ikebukuro, mode);
      expect(it1).not.toBeNull();
      for (let i = 1; i < it1!.legs.length; i++) {
        if (!it1!.legs[i].through) {
          expect(net.stations[it1!.legs[i - 1].to].group).toBe(net.stations[it1!.legs[i].from].group);
        }
      }
      const ev = evaluateRoute(net, it1!.legs, mode);
      expect(ev.totalSec).toBe(it1!.totalSec);
      expect(ev.transfers).toBe(it1!.transfers);
    }
  });

  it('同じプレイヤー用グループの組は出題しない', () => {
    const pair = [tokyo, ikebukuro];
    for (let i = 0; i < 20; i++) {
      expect(generateQuestion(net, pair, { minTransfers: 0, rng: () => Math.random() })).toBeNull();
    }
    expect(generateQuestion(plain, [findStation(plain, '山手線', '東京'), findStation(plain, '副都心線', '池袋')], { minTransfers: 0 })).not.toBeNull();
  });

  it('playerOnlySplit: 模範解答は部分間を歩けず、プレイヤーは歩ける（+transferSec・乗換+1）。出題もしない', () => {
    const pn = build({ playerOnlySplit: [['新宿', '新宿三丁目', '新宿西口']] });
    const sp = build({ split: [['新宿', '新宿三丁目', '新宿西口']] });
    const a = findStation(pn, '山手線', '新宿');
    const b = findStation(pn, '副都心線', '新宿三丁目');
    expect(pn.stations.map((s) => s.group)).toEqual(sp.stations.map((s) => s.group));
    expect(pn.stations[a].group).not.toBe(pn.stations[b].group);
    expect(playerGroupOf(pn, a)).toBe(playerGroupOf(pn, b));
    const model = searchRoute(pn, a, b, 'time');
    expect(model?.legs.some((l) => pn.stations[l.from].name === '新宿三丁目' && pn.stations[l.to].name === '新宿')).toBeFalsy();
    const shinagawa = findStation(pn, '山手線', '品川');
    const ikebukuro = findStation(pn, '副都心線', '池袋');
    const legs = [
      { line: findLine(pn, '山手線'), from: shinagawa, to: a },
      { line: findLine(pn, '副都心線'), from: b, to: ikebukuro },
    ];
    expect(validateRoute(pn, shinagawa, ikebukuro, legs)).toEqual({ valid: true });
    const ev = evaluateRoute(pn, legs, 'time');
    const ride = legs.reduce((t, l) => t + evaluateRoute(pn, [l], 'time').rideSec, 0);
    expect(ev.transfers).toBe(1);
    expect(ev.totalSec).toBe(ride + pn.transferSec);
    expect(validateRoute(sp, shinagawa, ikebukuro, legs).valid).toBe(false);
    for (let i = 0; i < 20; i++) expect(generateQuestion(pn, [a, b], { minTransfers: 0, rng: () => Math.random() })).toBeNull();
    expect(() => build({ playerOnlySplit: [['新宿', '新宿三丁目']] })).toThrow(/新宿西口/);
  });

  it('該当グループが無い・既に同じグループならビルド失敗', () => {
    expect(() => build({ playerOnlyMerge: [[['東京'], ['存在しない駅']]] })).toThrow(/0 件/);
    expect(() => build({ playerOnlyMerge: [[['新宿'], ['新宿西口']]] })).toThrow(/既に同じ/);
  });
});
