import { describe, expect, it } from 'vitest';
import { endpointStations } from '../src/lib/networkIndex.ts';
import { searchRoute } from '../src/lib/raptor.ts';
import { generateQuestion } from '../src/lib/question.ts';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { buildLeg, buildStationOptions, formatRouteLegs, markThroughStationOptions } from '../src/lib/game.ts';
import { findStation, miniNetwork } from './fixtures/miniMt3d.ts';
import type { AnswerMode, RouteLeg } from '../src/lib/types.ts';

// フィクスチャの「新宿」グループは 新宿(山手線・中央線) / 新宿三丁目(副都心線) / 新宿西口(大江戸線) の3つの駅名を持つ。
describe('端点は「グループ＋駅名」で決まる', () => {
  const network = miniNetwork();
  const st = (line: string, name: string) => findStation(network, line, name);
  const li = (name: string) => network.lines.findIndex((l) => l.name === name);
  const tokyo = st('山手線', '東京');
  const shinjuku = st('山手線', '新宿');
  const shinjuku3 = st('副都心線', '新宿三丁目');
  const shibuya = st('副都心線', '渋谷');

  it('endpointStations: 同グループ・同駅名のレコードだけ（新宿は山手線と中央線の2レコード）', () => {
    expect(endpointStations(network, shinjuku).sort()).toEqual([shinjuku, st('中央線', '新宿')].sort());
    expect(endpointStations(network, shinjuku3)).toEqual([shinjuku3]);
  });

  it('模範解答: 到着が新宿三丁目なら最後の降車は新宿三丁目（新宿で降りて終わりにならない）', () => {
    for (const mode of ['time', 'transfers'] as AnswerMode[]) {
      const itin = searchRoute(network, tokyo, shinjuku3, mode)!;
      expect(itin.legs[itin.legs.length - 1].to).toBe(shinjuku3);
    }
  });

  it('模範解答: 出発が新宿三丁目なら最初の乗車は新宿三丁目（新宿から始めない）', () => {
    for (const mode of ['time', 'transfers'] as AnswerMode[]) {
      const itin = searchRoute(network, shinjuku3, st('東横線', '横浜'), mode)!;
      expect(itin.legs[0].from).toBe(shinjuku3);
    }
  });

  it('途中の乗換はグループ全体: 新宿で降りて新宿三丁目に乗り換えられる', () => {
    const itin = searchRoute(network, tokyo, shibuya, 'transfers')!;
    expect(itin.legs.map((l) => network.stations[l.from].name)).toEqual(['東京', '新宿三丁目']);
    expect(network.stations[itin.legs[0].to].name).toBe('新宿');
  });

  it('模範解答を評価すると自分自身と一致する（端点名つき）', () => {
    for (const mode of ['time', 'transfers'] as AnswerMode[]) {
      for (const [o, d] of [
        [tokyo, shinjuku3],
        [shinjuku3, st('東横線', '横浜')],
        [tokyo, shibuya],
      ]) {
        const itin = searchRoute(network, o, d, mode)!;
        const legs: RouteLeg[] = itin.legs.map((l) => ({ line: l.line, from: l.from, to: l.to }));
        expect(validateRoute(network, o, d, legs).valid).toBe(true);
        const ev = evaluateRoute(network, legs, mode);
        expect(ev.totalSec).toBe(itin.totalSec);
        expect(ev.transfers).toBe(itin.transfers);
      }
    }
  });

  it('validateRoute: 最後の降車駅の駅名が違えば wrong-destination（同じグループでも）', () => {
    const leg: RouteLeg = { line: li('中央線'), from: st('中央線', '東京'), to: st('中央線', '新宿') };
    expect(validateRoute(network, tokyo, shinjuku, [leg]).valid).toBe(true);
    expect(validateRoute(network, tokyo, shinjuku3, [leg]).reason).toBe('wrong-destination');
  });

  it('validateRoute: 最初の乗車駅の駅名が違えば wrong-origin（同じグループでも）', () => {
    const leg: RouteLeg = { line: li('副都心線'), from: shinjuku3, to: shibuya };
    expect(validateRoute(network, shinjuku3, shibuya, [leg]).valid).toBe(true);
    expect(validateRoute(network, shinjuku, shibuya, [leg])).toEqual({
      valid: false,
      reason: 'wrong-origin',
      legIndex: 0,
    });
  });

  it('evaluateRoute: 同じ路線が別名のレコードを持つ場合、端点は選んだ駅名の側だけ（大江戸線 新宿西口）', () => {
    const oedo = li('大江戸線');
    const leg: RouteLeg = { line: oedo, from: st('大江戸線', '新宿西口'), to: st('大江戸線', '練馬') };
    expect(evaluateRoute(network, [leg]).totalSec).toBe(1020);
  });

  it('buildLeg: 現在駅は同名レコード優先・降車駅は選択路線に同名レコードがなければすり替えない', () => {
    const leg = buildLeg(network, li('副都心線'), shinjuku3, shibuya);
    expect(leg).toEqual({ line: li('副都心線'), from: shinjuku3, to: shibuya });
    // 中央線に新宿三丁目のレコードは無いので、新宿へすり替えずそのまま（validate が station-not-on-line にする）
    const bad = buildLeg(network, li('中央線'), tokyo, shinjuku3);
    expect(bad.to).toBe(shinjuku3);
    expect(validateRoute(network, tokyo, shinjuku3, [bad]).reason).toBe('station-not-on-line');
  });

  it('generateQuestion: minTransfers は端点名つきの searchRoute と一致する（全組合せ・両モード）', () => {
    const all = network.stations.map((_, i) => i);
    let checked = 0;
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        const q = generateQuestion(network, [a, b], { minTransfers: 0, rng: () => 0.1 });
        if (!q) continue;
        const ref = searchRoute(network, q.origin, q.destination, 'transfers');
        expect(ref).not.toBeNull();
        expect(q.minTransfers).toBe(ref!.transfers);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

// 直通パターン: 副都心線 池袋→新宿三丁目→渋谷 =(直通)= 東横線 渋谷→代官山→横浜 =(直通)= みなとみらい線
describe('1つの leg で直通先の路線の駅まで乗り続ける', () => {
  const network = miniNetwork();
  const st = (line: string, name: string) => findStation(network, line, name);
  const li = (name: string) => network.lines.findIndex((l) => l.name === name);
  const fuku = li('副都心線');
  const toyoko = li('東横線');
  const ikebukuro = st('副都心線', '池袋');
  const shibuyaF = st('副都心線', '渋谷');
  const shibuyaT = st('東横線', '渋谷');
  const yokohamaT = st('東横線', '横浜');
  const daikanyama = st('東横線', '代官山');

  const merged: RouteLeg[] = [{ line: fuku, from: ikebukuro, to: yokohamaT }];
  const split: RouteLeg[] = [
    { line: fuku, from: ikebukuro, to: shibuyaF },
    { line: toyoko, from: shibuyaT, to: yokohamaT },
  ];

  it('まとめた leg は有効', () => {
    expect(validateRoute(network, ikebukuro, yokohamaT, merged)).toEqual({ valid: true });
    expect(validateRoute(network, ikebukuro, yokohamaT, split)).toEqual({ valid: true });
  });

  it('transfers モード: まとめた leg と分けた leg は同じ総所要秒・乗換回数（直通パターンで乗る）', () => {
    const a = evaluateRoute(network, merged, 'transfers');
    const b = evaluateRoute(network, split, 'transfers');
    expect(a).toEqual(b);
    expect(a.transfers).toBe(0);
    expect(a.totalSec).toBe(2700);
  });

  it('time モードでも分けた leg と同じ値（まとめた leg は直通パターンに乗り続ける）', () => {
    // 分けた形は別パターンに乗り換えた方が速いので、直通に固定されるまとめた形のほうが遅い（2700秒）
    expect(evaluateRoute(network, merged, 'time').totalSec).toBe(2700);
    expect(evaluateRoute(network, split, 'time').totalSec).toBe(2460);
  });

  it('次の leg に直通のまま続けても乗換にならない', () => {
    const legs: RouteLeg[] = [
      { line: fuku, from: ikebukuro, to: daikanyama },
      { line: toyoko, from: daikanyama, to: yokohamaT },
    ];
    expect(validateRoute(network, ikebukuro, yokohamaT, legs).valid).toBe(true);
    const ev = evaluateRoute(network, legs, 'transfers');
    expect(ev.transfers).toBe(0);
    expect(ev.totalSec).toBe(2700);
  });

  it('方向が逆（その路線で乗ったパターンが直通先へ行かない）なら無効', () => {
    // 渋谷（副都心線）から横浜へは、副都心線の区間で出発する直通パターンが無い
    const leg: RouteLeg = { line: fuku, from: shibuyaF, to: yokohamaT };
    expect(validateRoute(network, shibuyaF, yokohamaT, [leg]).valid).toBe(false);
    // 横浜（東横線）から池袋（副都心線）へも不可（有向）
    const rev: RouteLeg = { line: toyoko, from: yokohamaT, to: ikebukuro };
    expect(validateRoute(network, yokohamaT, ikebukuro, [rev]).valid).toBe(false);
  });

  it('buildLeg: 直通先の駅は直通先の路線のレコードに解決する', () => {
    const leg = buildLeg(network, fuku, ikebukuro, yokohamaT);
    expect(leg).toEqual({ line: fuku, from: ikebukuro, to: yokohamaT });
  });

  it('候補: 選んだ路線で直通先に着ける駅に「〇〇線直通」の note が付く', () => {
    const base = buildStationOptions(network);
    const opts = markThroughStationOptions(network, base, fuku, ikebukuro);
    const yokohama = opts.find((o) => o.label === '横浜')!;
    expect(yokohama.note).toContain('東横線直通');
    expect(network.stations[yokohama.id].line).toBe(toyoko);
    // 自路線の駅には付かない
    expect(opts.find((o) => o.label === '新宿三丁目')!.note ?? '').not.toContain('直通');
    // 渋谷（副都心線にも駅がある）は自路線扱いで note なし
    expect(opts.find((o) => o.label === '渋谷')!.note ?? '').not.toContain('直通');
    // 逆向き（渋谷発の副都心線）では直通先に行けないので印は付かない
    const none = markThroughStationOptions(network, base, fuku, shibuyaF);
    expect(none.some((o) => (o.note ?? '').includes('直通'))).toBe(false);
  });

  it('表示: 直通先まで乗った leg は「（直通先の路線名直通）」付きで表示する', () => {
    expect(formatRouteLegs(network, merged)).toContain('副都心線（東京メトロ）（東横線直通） 池袋→横浜');
    expect(formatRouteLegs(network, split)).not.toContain('直通）');
  });

  it('端点名ルールはまとめた leg にも適用される', () => {
    // 到着が横浜（東横線の駅名）でなければ wrong-destination
    expect(validateRoute(network, ikebukuro, shibuyaF, merged).reason).toBe('wrong-destination');
  });
});
