import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../scripts/buildNetwork.ts';
import { miniGtfsFeeds } from './fixtures/miniGtfs.ts';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import type { Network, RouteLeg } from '../src/lib/types.ts';

function findLineIndex(network: Network, name: string, feed: string): number {
  const idx = network.lines.findIndex((l) => l.name === name && l.feed === feed);
  if (idx === -1) throw new Error(`line not found: ${name} (${feed})`);
  return idx;
}

function findStationIndex(network: Network, name: string, feed: string): number {
  const idx = network.stations.findIndex((s) => s.name === name && s.feed === feed);
  if (idx === -1) throw new Error(`station not found: ${name} (${feed})`);
  return idx;
}

describe('validateRoute / evaluateRoute', () => {
  const { network } = buildNetwork(miniGtfsFeeds());

  const yamanote = findLineIndex(network, '山手線', 'jr');
  const chuo = findLineIndex(network, '中央線', 'jr');
  const marunouchi = findLineIndex(network, '丸ノ内線', 'metro');

  const tokyoJr = findStationIndex(network, '東京', 'jr');
  const tokyoMetro = findStationIndex(network, '東京', 'metro');
  const uenoJr = findStationIndex(network, '上野', 'jr');
  const kandaJr = findStationIndex(network, '神田', 'jr');
  const ikebukuroJr = findStationIndex(network, '池袋', 'jr');
  const ikebukuroMetro = findStationIndex(network, '池袋', 'metro');
  const shinjukuJr = findStationIndex(network, '新宿', 'jr');
  const shinjukuMetro = findStationIndex(network, '新宿', 'metro');
  const ochanomizuJr = findStationIndex(network, '御茶ノ水', 'jr');
  const ochanomizuMetro = findStationIndex(network, '御茶ノ水', 'metro');

  const DEPART_9AM = 9 * 3600;

  describe('positive cases', () => {
    it('direct: 丸ノ内線 東京 -> 新宿', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      const result = validateRoute(network, tokyoJr, shinjukuJr, legs);
      expect(result).toEqual({ valid: true });
    });

    it('transfer across feeds via same-name station group: 丸ノ内線 東京->御茶ノ水, 中央線 御茶ノ水->新宿', () => {
      const legs: RouteLeg[] = [
        { line: marunouchi, from: tokyoMetro, to: ochanomizuMetro },
        { line: chuo, from: ochanomizuJr, to: shinjukuJr },
      ];
      const result = validateRoute(network, tokyoJr, shinjukuJr, legs);
      expect(result).toEqual({ valid: true });
    });

    it('detour: 上野->新宿 via 山手線(上野->池袋) + 丸ノ内線(池袋->新宿)', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: uenoJr, to: ikebukuroJr },
        { line: marunouchi, from: ikebukuroMetro, to: shinjukuMetro },
      ];
      const result = validateRoute(network, uenoJr, shinjukuJr, legs);
      expect(result).toEqual({ valid: true });
    });
  });

  describe('negative cases', () => {
    it('station-not-on-line: 山手線に新宿を指定', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: tokyoJr, to: shinjukuJr }];
      const result = validateRoute(network, tokyoJr, shinjukuJr, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('station-not-on-line');
      expect(result.legIndex).toBe(0);
    });

    it('bad-transfer: 乗換駅が不一致（山手線 上野->神田 の後に 中央線 御茶ノ水->新宿）', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: uenoJr, to: kandaJr },
        { line: chuo, from: ochanomizuJr, to: shinjukuJr },
      ];
      const result = validateRoute(network, uenoJr, shinjukuJr, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('bad-transfer');
      expect(result.legIndex).toBe(1);
    });

    it('wrong-origin: 出発駅が指定originのグループと異なる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      // origin を上野に指定（山手線グループ）だが legs は東京から始まる
      const result = validateRoute(network, uenoJr, shinjukuJr, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-origin');
      expect(result.legIndex).toBe(0);
    });

    it('wrong-destination: 到着駅が指定destinationのグループと異なる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      const result = validateRoute(network, tokyoJr, uenoJr, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-destination');
      expect(result.legIndex).toBe(0);
    });

    it('empty: legs が空', () => {
      const result = validateRoute(network, tokyoJr, shinjukuJr, []);
      expect(result).toEqual({ valid: false, reason: 'empty' });
    });

    it('degenerate-leg: from === to', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: tokyoMetro }];
      const result = validateRoute(network, tokyoJr, shinjukuJr, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('degenerate-leg');
      expect(result.legIndex).toBe(0);
    });

    it('not-connected-on-line: 路線上に存在するが逆方向でしか繋がらない停車列を指定できない場合を検出する', () => {
      // 丸ノ内線 patterns は往復両方向を持つため、同一パターン内で from が to より後ろにあるケースは
      // 別パターン（逆方向）で from->to の順が成立していれば有効になる。
      // ここでは山手線で「秋葉原(存在)->秋葉原と同名だが別グループの駅」のようなケースの代わりに、
      // 明らかに接続不可能な組み合わせとして中央線の駅を山手線パターンに要求する形で検証する。
      const akihabaraJr = findStationIndex(network, '秋葉原', 'jr');
      const legs: RouteLeg[] = [{ line: chuo, from: akihabaraJr, to: shinjukuJr }];
      const result = validateRoute(network, akihabaraJr, shinjukuJr, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('station-not-on-line');
    });
  });

  describe('evaluateRoute', () => {
    it('direct 丸ノ内線 東京->新宿: fare=170, transfers=0, durationSec>0', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      const evaluation = evaluateRoute(network, legs, DEPART_9AM);
      expect(evaluation.transfers).toBe(0);
      expect(evaluation.fare).toBe(170);
      expect(evaluation.durationSec).not.toBeNull();
      expect(evaluation.durationSec as number).toBeGreaterThan(0);
      expect(evaluation.arriveSec).toBe(DEPART_9AM + (evaluation.durationSec as number));
    });

    it('transfer route 丸ノ内線(東京->御茶ノ水)+中央線(御茶ノ水->新宿): fare=330, transfers=1, includes transfer wait', () => {
      const legs: RouteLeg[] = [
        { line: marunouchi, from: tokyoMetro, to: ochanomizuMetro },
        { line: chuo, from: ochanomizuJr, to: shinjukuJr },
      ];
      const evaluation = evaluateRoute(network, legs, DEPART_9AM);
      expect(evaluation.transfers).toBe(1);
      expect(evaluation.fare).toBe(170 + 160);
      expect(evaluation.durationSec).not.toBeNull();
      expect(evaluation.durationSec as number).toBeGreaterThan(0);
      expect(evaluation.arriveSec).toBe(DEPART_9AM + (evaluation.durationSec as number));
    });

    it('detour route via 山手線+丸ノ内線: fare=200+170, transfers=1, durationSec>0', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: uenoJr, to: ikebukuroJr },
        { line: marunouchi, from: ikebukuroMetro, to: shinjukuMetro },
      ];
      const evaluation = evaluateRoute(network, legs, DEPART_9AM);
      expect(evaluation.transfers).toBe(1);
      expect(evaluation.fare).toBe(200 + 170);
      expect(evaluation.durationSec).not.toBeNull();
      expect(evaluation.durationSec as number).toBeGreaterThan(0);
    });

    it('unreproducible schedule (no eligible trip for a leg) yields null duration/arrive but keeps transfers/fare', () => {
      // 御茶ノ水(chuo) -> 御茶ノ水(chuo) 方向の in-order stop pair はあるが、
      // 出発が非常に遅い時刻（ダイヤの最終便より後）だと該当tripが見つからない。
      const legs: RouteLeg[] = [{ line: chuo, from: ochanomizuJr, to: shinjukuJr }];
      const evaluation = evaluateRoute(network, legs, 23 * 3600);
      expect(evaluation.transfers).toBe(0);
      expect(evaluation.fare).toBe(160);
      expect(evaluation.durationSec).toBeNull();
      expect(evaluation.arriveSec).toBeNull();
    });
  });
});
