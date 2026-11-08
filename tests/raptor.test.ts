import { describe, expect, it } from 'vitest';
import { searchRoute } from '../src/lib/raptor.ts';
import { evaluateRoute } from '../src/lib/validate.ts';
import { findStation, miniNetwork } from './fixtures/miniMt3d.ts';
import type { AnswerMode, Network } from '../src/lib/types.ts';

describe('searchRoute（MT3Dフィクスチャ）', () => {
  const network = miniNetwork();
  const st = (line: string, name: string) => findStation(network, line, name);

  it('東京->新宿(time): 中央線 840秒・乗換0（山手線の1500秒より速い）', () => {
    const itin = searchRoute(network, st('山手線', '東京'), st('山手線', '新宿'), 'time')!;
    expect(itin.totalSec).toBe(840);
    expect(itin.transfers).toBe(0);
    expect(itin.legs).toHaveLength(1);
    expect(network.lines[itin.legs[0].line].name).toBe('中央線');
  });

  it('新宿->東京: パターンは有向なので中央線（東京→新宿のみ）には乗れず、山手線 1500秒', () => {
    const itin = searchRoute(network, st('山手線', '新宿'), st('山手線', '東京'), 'time')!;
    expect(itin.totalSec).toBe(1500);
    expect(itin.legs).toHaveLength(1);
    expect(network.lines[itin.legs[0].line].name).toBe('山手線');
  });

  it('品川->上野: 環状パターンの末尾→先頭をまたぐ（内回り 品川→東京→上野 1200秒）', () => {
    const itin = searchRoute(network, st('山手線', '品川'), st('山手線', '上野'), 'time')!;
    expect(itin.totalSec).toBe(1200);
    expect(itin.legs).toHaveLength(1);
    expect(itin.legs[0].from).toBe(st('山手線', '品川'));
    expect(itin.legs[0].to).toBe(st('山手線', '上野'));
    expect(itin.legs[0].rideSec).toBe(1200);
  });

  it('上野->品川: 外回りの環状パターンが使われる（環状の始点をまたいでもよい）', () => {
    // 内回り: 上野→新宿→品川 = 900+900 = 1800 / 外回り: 上野→東京→品川 = 600+600 = 1200
    const itin = searchRoute(network, st('山手線', '上野'), st('山手線', '品川'), 'time')!;
    expect(itin.totalSec).toBe(1200);
    expect(itin.transfers).toBe(0);
  });

  it('池袋->元町・中華街(transfers): 直通運転は乗換0。区間は路線ごとに分かれ through が付く', () => {
    const itin = searchRoute(
      network,
      st('副都心線', '池袋'),
      st('みなとみらい線', '元町・中華街'),
      'transfers'
    )!;
    expect(itin.transfers).toBe(0);
    expect(itin.totalSec).toBe(3300);
    expect(itin.rideSec).toBe(3300);
    expect(itin.legs.map((l) => network.lines[l.line].name)).toEqual([
      '副都心線',
      '東横線',
      'みなとみらい線',
    ]);
    expect(itin.legs.map((l) => l.through === true)).toEqual([false, true, true]);
    // 直通リンクの秒数（120秒）は後ろの区間に含まれる
    expect(itin.legs.map((l) => l.rideSec)).toEqual([900, 1800, 600]);
    expect(itin.legs[1].from).toBe(st('東横線', '渋谷'));
    expect(itin.legs[2].from).toBe(st('みなとみらい線', '横浜'));
  });

  it('池袋->横浜: time は乗換1回の方が速く(2460秒)、transfers は直通で乗換0(2700秒)', () => {
    // time: 副都心線F2(840) + 乗換300 + 東横線T2sat(1320) = 2460 / 直通(900+120+1680) = 2700
    const from = st('副都心線', '池袋');
    const to = st('東横線', '横浜');
    const time = searchRoute(network, from, to, 'time')!;
    expect(time.totalSec).toBe(2460);
    expect(time.transfers).toBe(1);
    expect(time.legs.map((l) => network.lines[l.line].name)).toEqual(['副都心線', '東横線']);
    expect(time.legs[1].through).toBeUndefined();

    const transfers = searchRoute(network, from, to, 'transfers')!;
    expect(transfers.transfers).toBe(0);
    expect(transfers.totalSec).toBe(2700);
    expect(transfers.legs[1].through).toBe(true);
  });

  it('池袋->元町・中華街(time): みなとみらい線へは別パターンの乗換(300秒)のほうが速い(3240秒・乗換2)', () => {
    // 副都心線F2 840 + 300 + 東横線T2sat 1320 + 300 + みなとみらい線(直通運用の区間) 480 = 3240
    const itin = searchRoute(
      network,
      st('副都心線', '池袋'),
      st('みなとみらい線', '元町・中華街'),
      'time'
    )!;
    expect(itin.totalSec).toBe(3240);
    expect(itin.transfers).toBe(2);
    expect(itin.rideSec).toBe(3240 - 2 * network.transferSec);
  });

  it('新宿西口->練馬: 大江戸線は都庁前でパターンを乗り換える（同じ路線でも乗換1回）', () => {
    const itin = searchRoute(network, st('大江戸線', '新宿西口'), st('大江戸線', '練馬'), 'time')!;
    expect(itin.totalSec).toBe(120 + 300 + 600);
    expect(itin.transfers).toBe(1);
    expect(itin.legs.map((l) => network.lines[l.line].name)).toEqual(['大江戸線', '大江戸線']);
    expect(itin.legs[1].through).toBeUndefined();
    expect(itin.legs[0].to).toBe(st('大江戸線', '都庁前'));
    expect(itin.legs[1].from).toBe(st('大江戸線', '都庁前'));
  });

  it('同一グループ（東京の山手線と中央線）は経路なし(null)', () => {
    expect(searchRoute(network, st('山手線', '東京'), st('中央線', '東京'), 'time')).toBeNull();
  });

  it('逆方向にしか走らない区間は到達不能(null): 練馬->新宿西口', () => {
    expect(searchRoute(network, st('大江戸線', '練馬'), st('大江戸線', '新宿西口'), 'time')).toBeNull();
  });

  it('Dijkstraの探索は1回あたり十分高速（小ネットワークで全組合せ）', () => {
    const t0 = performance.now();
    for (let a = 0; a < network.stations.length; a++) {
      for (let b = 0; b < network.stations.length; b++) {
        if (a !== b) searchRoute(network, a, b, 'time');
      }
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('模範解答の経路は evaluateRoute で同じ総所要秒・乗換回数に評価される（全組合せ・両モード）', () => {
    const modes: AnswerMode[] = ['time', 'transfers'];
    let checked = 0;
    for (const mode of modes) {
      for (let a = 0; a < network.stations.length; a++) {
        for (let b = 0; b < network.stations.length; b++) {
          if (a === b) continue;
          const itin = searchRoute(network, a, b, mode);
          if (itin === null) continue;
          const ev = evaluateRoute(network, itin.legs, mode);
          expect(ev.totalSec, `${mode} ${a}->${b}`).toBe(itin.totalSec);
          expect(ev.transfers, `${mode} ${a}->${b}`).toBe(itin.transfers);
          expect(ev.rideSec).toBe(itin.rideSec);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('searchRoute: transfers モードの優先順位', () => {
  it('乗換回数が少ない経路が、所要時間が長くても選ばれる', () => {
    const network: Network = {
      formatVersion: 3,
      stations: [
        { name: 'A', en: 'A', lat: 35, lon: 139, group: 0, line: 0 },
        { name: 'B', en: 'B', lat: 35, lon: 139.1, group: 1, line: 0 },
        { name: 'C', en: 'C', lat: 35, lon: 139.2, group: 2, line: 0 },
        { name: 'B', en: 'B', lat: 35, lon: 139.1, group: 1, line: 1 },
        { name: 'C', en: 'C', lat: 35, lon: 139.2, group: 2, line: 1 },
        { name: 'A', en: 'A', lat: 35, lon: 139, group: 0, line: 2 },
        { name: 'C', en: 'C', lat: 35, lon: 139.2, group: 2, line: 2 },
      ],
      lines: [
        { name: '甲線', en: 'Ko', company: 'テスト', color: null },
        { name: '乙線', en: 'Otsu', company: 'テスト', color: null },
        { name: '丙線', en: 'Hei', company: 'テスト', color: null },
      ],
      patterns: [
        { stops: [0, 1], segSec: [100], segLine: [0] }, // A->B 速い
        { stops: [3, 4], segSec: [100], segLine: [1] }, // B->C 速い
        { stops: [5, 6], segSec: [2000], segLine: [2] }, // A->C 遅い直行
      ],
      transferSec: 300,
    };
    const time = searchRoute(network, 0, 2, 'time')!;
    expect(time.transfers).toBe(1);
    expect(time.totalSec).toBe(100 + 300 + 100);
    const transfers = searchRoute(network, 0, 2, 'transfers')!;
    expect(transfers.transfers).toBe(0);
    expect(transfers.totalSec).toBe(2000);
    expect(network.lines[transfers.legs[0].line].name).toBe('丙線');
  });
});
