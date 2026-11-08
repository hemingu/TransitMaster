import { describe, expect, it } from 'vitest';
import {
  EXCLUDED_TRAIN_TYPES,
  OPERATOR_NAMES,
  buildMt3dNetwork,
  operatorName,
  parseTime,
} from '../scripts/buildMt3dNetwork.ts';
import { LINK_SEGMENT } from '../src/lib/types.ts';
import type { Network } from '../src/lib/types.ts';
import { findLine, findStation, miniMt3dInput } from './fixtures/miniMt3d.ts';

/** パターンを「路線名:駅名」の列と秒・路線の組に整形して探す。 */
function describePattern(network: Network, p: Network['patterns'][number]) {
  return {
    stops: p.stops.map((s) => network.stations[s].name),
    segSec: p.segSec,
    segLine: p.segLine.map((l) => (l === LINK_SEGMENT ? '直通' : network.lines[l].name)),
  };
}

describe('parseTime', () => {
  it('HH:MM を秒にする（24時以降も許す）', () => {
    expect(parseTime('06:05')).toBe(6 * 3600 + 5 * 60);
    expect(parseTime('24:10')).toBe(24 * 3600 + 10 * 60);
    expect(parseTime('25:00')).toBe(25 * 3600);
  });

  it('HH:MM:SS と不正な値', () => {
    expect(parseTime('06:05:30')).toBe(6 * 3600 + 5 * 60 + 30);
    expect(Number.isNaN(parseTime('abc'))).toBe(true);
  });
});

describe('operatorName', () => {
  it('id接頭辞から事業者名を返す。未登録は接頭辞そのまま', () => {
    expect(operatorName('JR-East.Yamanote')).toBe('JR東日本');
    expect(operatorName('TokyoMetro.Ginza')).toBe('東京メトロ');
    expect(operatorName('Unknown.Line')).toBe('Unknown');
    expect(OPERATOR_NAMES['Keikyu']).toBe('京急電鉄');
  });
});

describe('EXCLUDED_TRAIN_TYPES（有料列車）', () => {
  it('有料特急・座席指定ライナーを除外する', () => {
    for (const id of [
      'JR-East.LimitedExpress',
      'JR-Central.LimitedExpress',
      'Odakyu.LimitedExpress',
      'OdakyuHakone.LimitedExpress',
      'TokyoMetro.LimitedExpress',
      'Tobu.LimitedExpress',
      'Seibu.LimitedExpress',
      'Izukyu.LimitedExpress',
      'Fujikyu.LimitedExpress',
      'Keisei.Skyliner',
      'Keisei.Morningliner',
      'Keisei.Eveningliner',
      'Keio.KeioLiner',
      'Tobu.TJ-Liner',
      'Tobu.TH-LINER',
      'TokyoMetro.TH-LINER',
      'Seibu.HaijimaLiner',
      'Keikyu.MorningWing',
      'Keikyu.EveningWing',
    ]) {
      expect(EXCLUDED_TRAIN_TYPES.has(id), id).toBe(true);
    }
  });

  it('無料の「特急」「ライナー」は除外しない', () => {
    for (const id of [
      'Keikyu.LimitedExpress',
      'Keio.LimitedExpress',
      'Tokyu.LimitedExpress',
      'Sotetsu.LimitedExpress',
      'Keisei.LimitedExpress',
      'Keisei.AccessExpress',
      'Keisei.RapidLimitedExpress',
      'Toei.LimitedExpress',
      'Minatomirai.LimitedExpress',
      'Hokuso.LimitedExpress',
      'Shibayama.LimitedExpress',
      'Keikyu.AccessExpress',
      'Tokyu.CommuterLimitedExpress',
      'TokyoMetro.F-Liner',
      'Seibu.F-Liner',
      'JR-East.Rapid',
      'JR-East.Local',
    ]) {
      expect(EXCLUDED_TRAIN_TYPES.has(id), id).toBe(false);
    }
  });
});

describe('buildMt3dNetwork（フィクスチャ）', () => {
  const { network, log } = buildMt3dNetwork(miniMt3dInput());

  it('formatVersion 3・transferSec 300', () => {
    expect(network.formatVersion).toBe(3);
    expect(network.transferSec).toBe(300);
  });

  describe('有料列車の除外と路線・駅の絞り込み', () => {
    it('有料特急のみの路線（小田原線）は除外され、その駅も落ちる', () => {
      expect(network.lines.map((l) => l.name)).not.toContain('小田原線');
      expect(network.stations.some((s) => s.name === '小田原')).toBe(false);
      expect(log.some((l) => l.includes('Odakyu.Odawara'))).toBe(true);
    });

    it('路線・座標のない駅レコードは無視される', () => {
      expect(network.stations.some((s) => s.name === '幽霊駅')).toBe(false);
      expect(network.stations).toHaveLength(17);
      expect(network.lines).toHaveLength(6);
    });

    it('路線の名前・事業者名・色・ローマ字', () => {
      const yamanote = network.lines[findLine(network, '山手線')];
      expect(yamanote).toEqual({ name: '山手線', en: 'Yamanote Line', company: 'JR東日本', color: '9ACD32' });
      expect(network.lines[findLine(network, '副都心線')].company).toBe('東京メトロ');
    });

    it('駅の座標・ローマ字を持つ', () => {
      const s = network.stations[findStation(network, '東横線', '渋谷')];
      expect(s.en).toBe('Shibuya');
      expect(s.lon).toBeCloseTo(139.7016, 4);
      expect(s.lat).toBeCloseTo(35.6591, 4);
    });
  });

  describe('乗換グループ', () => {
    const group = (line: string, name: string) => network.stations[findStation(network, line, name)].group;

    it('station-groups: 新宿（山手線・中央線・副都心線の新宿三丁目・大江戸線の新宿西口）が1グループ', () => {
      const g = group('山手線', '新宿');
      expect(group('中央線', '新宿')).toBe(g);
      expect(group('副都心線', '新宿三丁目')).toBe(g);
      expect(group('大江戸線', '新宿西口')).toBe(g);
    });

    it('station-groups: 渋谷・横浜（路線が違うレコード）も束ねられる', () => {
      expect(group('副都心線', '渋谷')).toBe(group('東横線', '渋谷'));
      expect(group('東横線', '横浜')).toBe(group('みなとみらい線', '横浜'));
    });

    it('alternate: station-groups に載っていない東京（山手線と中央線）も統合される', () => {
      expect(group('山手線', '東京')).toBe(group('中央線', '東京'));
    });

    it('グループ外の駅は単独グループ', () => {
      const g = group('山手線', '上野');
      expect(network.stations.filter((s) => s.group === g)).toHaveLength(1);
      expect(group('山手線', '上野')).not.toBe(group('山手線', '東京'));
    });

    it('同名かつ近接（250m以内）の駅は、グループ定義がなくても統合される', () => {
      const input = miniMt3dInput();
      input.stations.push({
        id: 'Tokyu.Toyoko.Daikanyama2',
        railway: 'Tokyu.Toyoko',
        coord: [139.7033, 35.6487],
        title: { ja: '代官山', en: 'Daikanyama' },
      });
      // 2つ目の代官山を使う列車
      input.trains.push({
        id: 'Tokyu.Toyoko.T9.Weekday',
        r: 'Tokyu.Toyoko',
        y: 'Tokyu.Local',
        tt: [
          { s: 'Tokyu.Toyoko.Daikanyama2', d: '10:00' },
          { s: 'Tokyu.Toyoko.Yokohama', a: '10:20' },
        ],
      });
      const built = buildMt3dNetwork(input).network;
      const daikanyamas = built.stations.filter((s) => s.name === '代官山');
      expect(daikanyamas).toHaveLength(2);
      expect(daikanyamas[0].group).toBe(daikanyamas[1].group);
    });
  });

  describe('運用の連結（直通運転）と直通リンク', () => {
    it('副都心線→東横線→みなとみらい線が1つのパターンになり、路線の切り替わりは直通リンク', () => {
      const through = network.patterns.map((p) => describePattern(network, p)).find((d) => d.segLine.includes('直通'))!;
      expect(through).toBeDefined();
      expect(through.stops).toEqual(['池袋', '新宿三丁目', '渋谷', '渋谷', '代官山', '横浜', '横浜', '元町・中華街']);
      expect(through.segLine).toEqual(['副都心線', '副都心線', '直通', '東横線', '東横線', '直通', 'みなとみらい線']);
      // 途中駅は出発時刻、終着は到着時刻で累積。直通リンク = 次の出発 - 前の到着
      expect(through.segSec).toEqual([540, 360, 120, 180, 1500, 120, 480]);
    });

    it('直通は1つしかない（他に路線をまたぐパターンはない）', () => {
      const linked = network.patterns.filter((p) => p.segLine.includes(LINK_SEGMENT));
      expect(linked).toHaveLength(1);
    });

    it('直通リンクの区間は駅レコードが異なる（同一レコードなら1ノードに統合される）', () => {
      const p = network.patterns.find((x) => x.segLine.includes(LINK_SEGMENT))!;
      p.segLine.forEach((l, i) => {
        if (l === LINK_SEGMENT) {
          expect(p.stops[i]).not.toBe(p.stops[i + 1]);
          expect(network.stations[p.stops[i]].group).toBe(network.stations[p.stops[i + 1]].group);
        } else {
          expect(network.stations[p.stops[i]].line).toBe(l);
          expect(network.stations[p.stops[i + 1]].line).toBe(l);
        }
      });
    });

    it('同じ駅レコードでの列車の継ぎ目は1ノードに統合される（時刻は次列車の出発）', () => {
      const input = miniMt3dInput();
      // 中央線 C3: 東京→新宿(着 10:00, 発なし) の続きに C4: 新宿→東京?? ではなく同路線の続きを作る
      input.stations.push({ id: 'JR-East.Chuo.Ochanomizu', railway: 'JR-East.Chuo', coord: [139.76, 35.7], title: { ja: '御茶ノ水', en: 'Ochanomizu' } });
      input.trains.push(
        { id: 'JR-East.Chuo.J1.Weekday', r: 'JR-East.Chuo', y: 'JR-East.Local', tt: [{ s: 'JR-East.Chuo.Tokyo', d: '10:00' }, { s: 'JR-East.Chuo.Ochanomizu', a: '10:05' }], nt: ['JR-East.Chuo.J2.Weekday'] },
        { id: 'JR-East.Chuo.J2.Weekday', r: 'JR-East.Chuo', y: 'JR-East.Local', tt: [{ s: 'JR-East.Chuo.Ochanomizu', d: '10:07' }, { s: 'JR-East.Chuo.Shinjuku', a: '10:15' }], pt: ['JR-East.Chuo.J1.Weekday'] }
      );
      const built = buildMt3dNetwork(input).network;
      const p = built.patterns
        .map((x) => describePattern(built, x))
        .find((d) => d.stops.join() === '東京,御茶ノ水,新宿')!;
      expect(p).toBeDefined();
      expect(p.segLine).toEqual(['中央線', '中央線']); // 直通リンクなし
      expect(p.segSec).toEqual([420, 480]); // 御茶ノ水は次列車の出発10:07
    });

    it('次列車のループ（A→B→A）でも無限ループせず、各列車がパターンになる', () => {
      const input = miniMt3dInput();
      input.trains.push(
        { id: 'JR-East.Chuo.X1.Weekday', r: 'JR-East.Chuo', y: 'JR-East.Local', tt: [{ s: 'JR-East.Chuo.Tokyo', d: '12:00' }, { s: 'JR-East.Chuo.Shinjuku', a: '12:10' }], nt: ['JR-East.Chuo.X2.Weekday'], pt: ['JR-East.Chuo.X2.Weekday'] },
        { id: 'JR-East.Chuo.X2.Weekday', r: 'JR-East.Chuo', y: 'JR-East.Local', tt: [{ s: 'JR-East.Chuo.Shinjuku', d: '12:15' }, { s: 'JR-East.Chuo.Tokyo', a: '12:25' }], nt: ['JR-East.Chuo.X1.Weekday'], pt: ['JR-East.Chuo.X1.Weekday'] }
      );
      const built = buildMt3dNetwork(input).network;
      const names = built.patterns.map((x) => describePattern(built, x).stops.join());
      expect(names).toContain('東京,新宿'); // 東京→新宿（中央線 C1 と同じ系列）
      expect(names).toContain('新宿,東京'); // 逆向き
    });
  });

  describe('最速の運用の選択', () => {
    it('同じ系列の運用は合計所要が最小の運用を採る（C1 840秒 > C2 900秒）', () => {
      const chuo = network.patterns
        .map((p) => describePattern(network, p))
        .filter((d) => d.stops.join() === '東京,新宿' && d.segLine[0] === '中央線');
      expect(chuo).toHaveLength(1);
      expect(chuo[0].segSec).toEqual([840]);
    });

    it('平日と土休日のダイヤを併用し、最速（土休日 1320秒 < 平日 1500秒）を採る', () => {
      const t2 = network.patterns
        .map((p) => describePattern(network, p))
        .filter((d) => d.stops.join() === '渋谷,横浜');
      expect(t2).toHaveLength(1);
      expect(t2[0].segSec).toEqual([1320]);
    });

    it('日またぎの時刻（23:55 -> 00:03 -> 00:10）は +24h で補正される', () => {
      const f3 = network.patterns
        .map((p) => describePattern(network, p))
        .find((d) => d.stops.join() === '渋谷,新宿三丁目,池袋')!;
      expect(f3.segSec).toEqual([480, 420]);
    });

    it('区間ごとの最小値は取らない: 採用した1運用の区間秒がそのまま入る', () => {
      // 山手線 内回り: 速い in1 (600,900,900,600) と遅い in2 (720,960,1020,600) -> in1 のみ
      const inner = network.patterns
        .map((p) => describePattern(network, p))
        .find((d) => d.stops.join() === '東京,上野,新宿,品川,東京')!;
      expect(inner.segSec).toEqual([600, 900, 900, 600]);
    });
  });

  describe('環状パターン（山手線）', () => {
    it('方向ごとに1パターン（始点を末尾に再掲）。1周列車の最速から作る', () => {
      const rings = network.patterns
        .map((p) => describePattern(network, p))
        .filter((d) => d.stops[0] === d.stops[d.stops.length - 1]);
      expect(rings.map((d) => d.stops.join()).sort()).toEqual(
        ['東京,上野,新宿,品川,東京', '東京,品川,新宿,上野,東京'].sort()
      );
      for (const r of rings) expect(r.segSec.reduce((a, b) => a + b, 0)).toBe(3000);
    });
  });

  describe('刈り込み', () => {
    it('他パターンの連続部分列で時間が同等以下のものは除かれる', () => {
      const all = network.patterns.map((p) => describePattern(network, p).stops.join());
      // 環状より遅い山手線の区間列車（東京→上野 720秒 > 環状の同区間 600秒）
      expect(all.filter((s) => s === '東京,上野')).toHaveLength(0);
      // 東横線の各停 T3（2400秒）は直通運用の同区間（1680秒）より遅いので除かれる
      expect(all.filter((s) => s === '渋谷,代官山,横浜')).toHaveLength(0);
      // みなとみらい線 M2（480秒）は直通運用の同区間（480秒）と同等なので除かれる
      expect(all.filter((s) => s === '横浜,元町・中華街')).toHaveLength(0);
    });

    it('包含する側が遅ければ残る: 副都心線 F2（840秒）は直通運用の同区間（900秒）より速いので残る', () => {
      const f2 = network.patterns
        .map((p) => describePattern(network, p))
        .filter((d) => d.stops.join() === '池袋,新宿三丁目,渋谷' && d.segLine[0] === '副都心線');
      expect(f2).toHaveLength(1);
      expect(f2[0].segSec).toEqual([480, 360]);
    });

    it('パターン数: 環状2 + 中央線 + 直通 + 副都心線2 + 東横線急行 + 大江戸線2 = 9', () => {
      expect(network.patterns).toHaveLength(9);
    });

    it('大江戸線の2系統（新宿西口→都庁前 / 都庁前→練馬）は互いに部分列でないので両方残る', () => {
      const stops = network.patterns.map((p) => describePattern(network, p).stops.join());
      expect(stops).toContain('新宿西口,都庁前');
      expect(stops).toContain('都庁前,練馬');
    });
  });

  it('全パターンで stops / segSec / segLine の長さが整合し、segLine は有効な路線かリンク', () => {
    for (const p of network.patterns) {
      expect(p.segSec).toHaveLength(p.stops.length - 1);
      expect(p.segLine).toHaveLength(p.stops.length - 1);
      for (const l of p.segLine) expect(l === LINK_SEGMENT || (l >= 0 && l < network.lines.length)).toBe(true);
      for (const s of p.stops) expect(s >= 0 && s < network.stations.length).toBe(true);
      for (const sec of p.segSec) expect(Number.isInteger(sec) && sec >= 0).toBe(true);
    }
  });

  it('各駅レコードの line は自分の路線（そのレコードを含む区間の路線）', () => {
    for (const p of network.patterns) {
      p.segLine.forEach((l, i) => {
        if (l === LINK_SEGMENT) return;
        expect(network.stations[p.stops[i]].line).toBe(l);
      });
    }
  });
});
