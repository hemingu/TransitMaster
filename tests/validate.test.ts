import { describe, expect, it } from 'vitest';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { buildMt3dNetwork } from '../scripts/buildMt3dNetwork.ts';
import { findStation, miniMt3dInput, miniNetwork } from './fixtures/miniMt3d.ts';
import type { RouteLeg } from '../src/lib/types.ts';

describe('validateRoute / evaluateRoute（MT3Dフィクスチャ）', () => {
  const network = miniNetwork();
  const st = (line: string, name: string) => findStation(network, line, name);
  const L = (lineName: string, from: string, to: string, toLine = lineName, fromLine = lineName): RouteLeg => ({
    line: network.lines.findIndex((l) => l.name === lineName),
    from: st(fromLine, from),
    to: st(toLine, to),
  });

  const tokyo = st('山手線', '東京');
  const shinjuku = st('山手線', '新宿');
  const ikebukuro = st('副都心線', '池袋');
  const motomachi = st('みなとみらい線', '元町・中華街');

  describe('validateRoute', () => {
    it('山手線 東京→新宿 は有効', () => {
      expect(validateRoute(network, tokyo, shinjuku, [L('山手線', '東京', '新宿')])).toEqual({ valid: true });
    });

    it('legs が空なら empty', () => {
      expect(validateRoute(network, tokyo, shinjuku, []).reason).toBe('empty');
    });

    it('乗車駅と降車駅が同じなら degenerate-leg', () => {
      const r = validateRoute(network, tokyo, shinjuku, [L('山手線', '東京', '東京')]);
      expect(r).toEqual({ valid: false, reason: 'degenerate-leg', legIndex: 0 });
    });

    it('駅が路線のレコードでなければ station-not-on-line', () => {
      const leg: RouteLeg = {
        line: network.lines.findIndex((l) => l.name === '山手線'),
        from: tokyo,
        to: st('中央線', '新宿'),
      };
      expect(validateRoute(network, tokyo, shinjuku, [leg]).reason).toBe('station-not-on-line');
    });

    it('有向: 中央線は東京→新宿のみで、新宿→東京は not-connected-on-line', () => {
      const ok = validateRoute(network, tokyo, shinjuku, [L('中央線', '東京', '新宿')]);
      expect(ok.valid).toBe(true);
      const ng = validateRoute(network, shinjuku, tokyo, [L('中央線', '新宿', '東京')]);
      expect(ng).toEqual({ valid: false, reason: 'not-connected-on-line', legIndex: 0 });
    });

    it('路線内のパターン乗換を許す: 大江戸線 新宿西口→練馬（都庁前で乗換）は有効', () => {
      const from = st('大江戸線', '新宿西口');
      const to = st('大江戸線', '練馬');
      expect(validateRoute(network, from, to, [L('大江戸線', '新宿西口', '練馬')]).valid).toBe(true);
    });

    it('出発駅が違えば wrong-origin、到着駅が違えば wrong-destination', () => {
      const leg = L('山手線', '東京', '上野');
      expect(validateRoute(network, shinjuku, st('山手線', '上野'), [leg]).reason).toBe('wrong-origin');
      expect(validateRoute(network, tokyo, shinjuku, [leg]).reason).toBe('wrong-destination');
    });

    it('乗換駅が別グループなら bad-transfer', () => {
      const legs = [L('山手線', '東京', '上野'), L('中央線', '東京', '新宿')];
      const r = validateRoute(network, tokyo, shinjuku, legs);
      expect(r).toEqual({ valid: false, reason: 'bad-transfer', legIndex: 1 });
    });

    it('グループが同じならレコードが違っても乗換になる（山手線の東京→中央線の東京）', () => {
      const legs = [L('山手線', '東京', '上野'), L('山手線', '上野', '新宿')];
      expect(validateRoute(network, tokyo, shinjuku, legs).valid).toBe(true);
    });
  });

  describe('evaluateRoute', () => {
    it('単一の leg: 中央線 東京→新宿 は 840秒・乗換0', () => {
      const ev = evaluateRoute(network, [L('中央線', '東京', '新宿')]);
      expect(ev).toEqual({ transfers: 0, rideSec: 840, totalSec: 840 });
    });

    it('環状: 山手線 品川→上野 は短い側（内回り 品川→東京→上野 1200秒）', () => {
      const ev = evaluateRoute(network, [L('山手線', '品川', '上野')]);
      expect(ev.totalSec).toBe(1200);
      expect(ev.transfers).toBe(0);
    });

    it('同じパターンのまま leg を分けても乗換にならない（山手線 東京→上野→新宿）', () => {
      const ev = evaluateRoute(network, [L('山手線', '東京', '上野'), L('山手線', '上野', '新宿')]);
      expect(ev).toEqual({ transfers: 0, rideSec: 1500, totalSec: 1500 });
    });

    it('路線内のパターン乗換: 大江戸線 新宿西口→練馬 は 120+300+600=1020秒・乗換1回', () => {
      for (const mode of ['time', 'transfers'] as const) {
        const ev = evaluateRoute(network, [L('大江戸線', '新宿西口', '練馬')], mode);
        expect(ev.totalSec).toBe(1020);
        expect(ev.transfers).toBe(1);
        expect(ev.rideSec).toBe(720);
      }
    });

    it('路線内で leg を分けても結果は同じ（都庁前で2 leg: 乗換1回）', () => {
      const ev = evaluateRoute(network, [
        L('大江戸線', '新宿西口', '都庁前'),
        L('大江戸線', '都庁前', '練馬'),
      ]);
      expect(ev.totalSec).toBe(1020);
      expect(ev.transfers).toBe(1);
    });

    it('直通運転: 副都心線→東横線→みなとみらい線 は transfers 評価で乗換0・3300秒（リンク込み）', () => {
      const legs = [
        L('副都心線', '池袋', '渋谷'),
        L('東横線', '渋谷', '横浜'),
        L('みなとみらい線', '横浜', '元町・中華街'),
      ];
      expect(validateRoute(network, ikebukuro, motomachi, legs).valid).toBe(true);
      const ev = evaluateRoute(network, legs, 'transfers');
      expect(ev).toEqual({ transfers: 0, rideSec: 3300, totalSec: 3300 });
    });

    it('同じ legs を time 評価すると、直通より別パターンへ乗り換える方が速い場合はそちらを採る（3240秒・乗換2）', () => {
      const legs = [
        L('副都心線', '池袋', '渋谷'),
        L('東横線', '渋谷', '横浜'),
        L('みなとみらい線', '横浜', '元町・中華街'),
      ];
      const ev = evaluateRoute(network, legs, 'time');
      expect(ev.totalSec).toBe(3240);
      expect(ev.transfers).toBe(2);
    });

    it('直通の途中で降りて別のパターンに乗れば乗換: 池袋→渋谷(副都心線)→横浜(東横線) は直通2700秒/乗換0（transfers）', () => {
      const legs = [L('副都心線', '池袋', '渋谷'), L('東横線', '渋谷', '横浜')];
      expect(evaluateRoute(network, legs, 'transfers')).toEqual({
        transfers: 0,
        rideSec: 2700,
        totalSec: 2700,
      });
      // time では F2(840)+乗換300+T2sat(1320)=2460
      expect(evaluateRoute(network, legs, 'time')).toEqual({ transfers: 1, rideSec: 2160, totalSec: 2460 });
    });

    it('乗換回数は legs.length - 1 ではなく実際のパターン乗換の数', () => {
      const legs = [L('副都心線', '池袋', '渋谷'), L('東横線', '渋谷', '横浜')];
      const ev = evaluateRoute(network, legs, 'transfers');
      expect(ev.transfers).toBe(0);
      expect(legs.length - 1).toBe(1);
    });

    it('到達不能な leg があれば totalSec は null', () => {
      const ev = evaluateRoute(network, [L('中央線', '新宿', '東京')]);
      expect(ev.totalSec).toBeNull();
    });

    it('東横線の横浜と同一レコードを to に指定しても評価できる', () => {
      const ev = evaluateRoute(network, [L('東横線', '渋谷', '横浜')], 'time');
      expect(ev.totalSec).toBe(1320); // T2sat（最速）
    });
  });

  describe('同じ路線が同じ駅に複数の駅レコードを持つ場合（大江戸線の都庁前など）', () => {
    // 都庁前のレコードを2つに分け（O1 は都庁前A、O2 は都庁前Bから出る）、同じグループにする
    const input = miniMt3dInput();
    input.stations.push({
      id: 'Toei.Oedo.TochomaeB',
      railway: 'Toei.Oedo',
      coord: [139.6918, 35.6897],
      title: { ja: '都庁前', en: 'Tochomae' },
    });
    const o2 = input.trains.find((t) => t.id === 'Toei.Oedo.O2.Weekday')!;
    o2.tt[0].s = 'Toei.Oedo.TochomaeB';
    input.stationGroups.push([['Toei.Oedo.Tochomae'], ['Toei.Oedo.TochomaeB']]);
    const net = buildMt3dNetwork(input).network;
    const oedo = net.lines.findIndex((l) => l.name === '大江戸線');
    const recs = net.stations.map((s, i) => ({ s, i })).filter((x) => x.s.line === oedo && x.s.name === '都庁前');

    it('都庁前は2レコードで同一グループ', () => {
      expect(recs).toHaveLength(2);
      expect(recs[0].s.group).toBe(recs[1].s.group);
    });

    it('どちらのレコードを指定しても同じ駅として評価・検証される（先頭レコードで指定しても乗換できる）', () => {
      const sn = net.stations.findIndex((s) => s.line === oedo && s.name === '新宿西口');
      const nerima = net.stations.findIndex((s) => s.line === oedo && s.name === '練馬');
      const legs: RouteLeg[] = [
        { line: oedo, from: sn, to: recs[0].i },
        { line: oedo, from: recs[0].i, to: nerima },
      ];
      expect(validateRoute(net, sn, nerima, legs).valid).toBe(true);
      expect(evaluateRoute(net, legs)).toEqual({ transfers: 1, rideSec: 720, totalSec: 1020 });
      const single: RouteLeg[] = [{ line: oedo, from: sn, to: nerima }];
      expect(evaluateRoute(net, single).totalSec).toBe(1020);
    });
  });
});
