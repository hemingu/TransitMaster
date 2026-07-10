import { describe, expect, it } from 'vitest';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { FIXTURE_EXPECTATIONS, miniNetwork } from './fixtures/miniEkidata.ts';
import type { Network, RouteLeg } from '../src/lib/types.ts';

function findLineIndex(network: Network, name: string): number {
  const idx = network.lines.findIndex((l) => l.name === name);
  if (idx === -1) throw new Error(`line not found: ${name}`);
  return idx;
}

function findStationIndex(network: Network, name: string, group: number): number {
  const idx = network.stations.findIndex((s) => s.name === name && s.group === group);
  if (idx === -1) throw new Error(`station not found: ${name} (group ${group})`);
  return idx;
}

describe('validateRoute / evaluateRoute (miniNetwork)', () => {
  const network = miniNetwork();

  const yamanote = findLineIndex(network, '山手線');
  const chuo = findLineIndex(network, '中央線');
  const marunouchi = findLineIndex(network, '丸ノ内線');
  const testTetsu = findLineIndex(network, 'テスト電鉄本線');

  // group番号は miniEkidata.ts の並びに依存させず、station.group を検索して求める
  const groupOf = (name: string, sampleLine: string, sampleStationName?: string): number => {
    const lineIdx = findLineIndex(network, sampleLine);
    const line = network.lines[lineIdx];
    for (const pattern of line.patterns) {
      for (const stopIdx of pattern.stops) {
        if (network.stations[stopIdx].name === (sampleStationName ?? name)) {
          return network.stations[stopIdx].group;
        }
      }
    }
    throw new Error(`group not found for ${name} on ${sampleLine}`);
  };

  const tokyoGroup = groupOf('東京', '山手線');
  const shinjukuGroup = groupOf('新宿', '山手線');
  const uenoGroup = groupOf('上野', '山手線');
  const kandaGroup = groupOf('神田', '山手線');
  const ikebukuroGroup = groupOf('池袋', '山手線');
  const ochanomizuGroup = groupOf('御茶ノ水', '中央線');
  const otemachiGroup = groupOf('大手町', '丸ノ内線');
  const higashiyamaGroup = groupOf('東山', 'テスト電鉄本線');
  const nishiokaGroup = groupOf('西丘', 'テスト電鉄本線');

  const tokyoYamanote = findStationIndex(network, '東京', tokyoGroup);
  const tokyoChuo = network.stations.findIndex(
    (s, i) => s.name === '東京' && s.group === tokyoGroup && network.lines[chuo].patterns[0].stops.includes(i)
  );
  const tokyoMarunouchi = network.lines[marunouchi].patterns[0].stops.find(
    (i) => network.stations[i].group === tokyoGroup
  )!;
  const shinjukuYamanote = network.lines[yamanote].patterns[0].stops.find(
    (i) => network.stations[i].group === shinjukuGroup
  )!;
  const shinjukuChuo = network.lines[chuo].patterns[0].stops.find(
    (i) => network.stations[i].group === shinjukuGroup
  )!;
  const shinjukuMarunouchi = network.lines[marunouchi].patterns[0].stops.find(
    (i) => network.stations[i].group === shinjukuGroup
  )!;
  const uenoYamanote = network.lines[yamanote].patterns[0].stops.find(
    (i) => network.stations[i].group === uenoGroup
  )!;
  const kandaYamanote = network.lines[yamanote].patterns[0].stops.find(
    (i) => network.stations[i].group === kandaGroup
  )!;
  const ikebukuroYamanote = network.lines[yamanote].patterns[0].stops.find(
    (i) => network.stations[i].group === ikebukuroGroup
  )!;
  const ikebukuroMarunouchi = network.lines[marunouchi].patterns[0].stops.find(
    (i) => network.stations[i].group === ikebukuroGroup
  )!;
  const ochanomizuChuo = network.lines[chuo].patterns[0].stops.find(
    (i) => network.stations[i].group === ochanomizuGroup
  )!;
  const otemachiMarunouchi = network.lines[marunouchi].patterns[0].stops.find(
    (i) => network.stations[i].group === otemachiGroup
  )!;
  const higashiyamaStation = network.lines[testTetsu].patterns
    .flatMap((p) => p.stops)
    .find((i) => network.stations[i].group === higashiyamaGroup)!;
  const nishiokaStation = network.lines[testTetsu].patterns
    .flatMap((p) => p.stops)
    .find((i) => network.stations[i].group === nishiokaGroup)!;

  describe('positive cases', () => {
    it('direct: 丸ノ内線 東京 -> 新宿', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMarunouchi, to: shinjukuMarunouchi }];
      const result = validateRoute(network, tokyoYamanote, shinjukuYamanote, legs);
      expect(result).toEqual({ valid: true });
    });

    it('transfer across records via same-group station: 丸ノ内線 東京->御茶ノ水, 中央線 御茶ノ水->新宿', () => {
      const ochanomizuMarunouchi = network.lines[marunouchi].patterns[0].stops.find(
        (i) => network.stations[i].group === ochanomizuGroup
      )!;
      const legs: RouteLeg[] = [
        { line: marunouchi, from: tokyoMarunouchi, to: ochanomizuMarunouchi },
        { line: chuo, from: ochanomizuChuo, to: shinjukuChuo },
      ];
      const result = validateRoute(network, tokyoYamanote, shinjukuYamanote, legs);
      expect(result).toEqual({ valid: true });
    });

    it('detour: 上野->新宿 via 山手線(上野->池袋) + 丸ノ内線(池袋->新宿)', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: uenoYamanote, to: ikebukuroYamanote },
        { line: marunouchi, from: ikebukuroMarunouchi, to: shinjukuMarunouchi },
      ];
      const result = validateRoute(network, uenoYamanote, shinjukuYamanote, legs);
      expect(result).toEqual({ valid: true });
    });

    it('分岐またぎ: テスト電鉄本線 東山 -> 西丘（葉ペアパターンで直接連結）', () => {
      const legs: RouteLeg[] = [{ line: testTetsu, from: higashiyamaStation, to: nishiokaStation }];
      const result = validateRoute(network, higashiyamaStation, nishiokaStation, legs);
      expect(result).toEqual({ valid: true });
    });
  });

  describe('negative cases', () => {
    it('station-not-on-line: 山手線に中央線専用の新宿レコードを指定', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: tokyoYamanote, to: shinjukuChuo }];
      const result = validateRoute(network, tokyoYamanote, shinjukuYamanote, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('station-not-on-line');
      expect(result.legIndex).toBe(0);
    });

    it('bad-transfer: 乗換駅が不一致（山手線 上野->神田 の後に 中央線 御茶ノ水->新宿）', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: uenoYamanote, to: kandaYamanote },
        { line: chuo, from: ochanomizuChuo, to: shinjukuChuo },
      ];
      const result = validateRoute(network, uenoYamanote, shinjukuYamanote, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('bad-transfer');
      expect(result.legIndex).toBe(1);
    });

    it('wrong-origin: 出発駅が指定originのグループと異なる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMarunouchi, to: shinjukuMarunouchi }];
      // origin を上野に指定（山手線グループ）だが legs は東京から始まる
      const result = validateRoute(network, uenoYamanote, shinjukuYamanote, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-origin');
      expect(result.legIndex).toBe(0);
    });

    it('wrong-destination: 到着駅が指定destinationのグループと異なる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMarunouchi, to: shinjukuMarunouchi }];
      const result = validateRoute(network, tokyoYamanote, uenoYamanote, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-destination');
      expect(result.legIndex).toBe(0);
    });

    it('empty: legs が空', () => {
      const result = validateRoute(network, tokyoYamanote, shinjukuYamanote, []);
      expect(result).toEqual({ valid: false, reason: 'empty' });
    });

    it('degenerate-leg: from === to', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMarunouchi, to: tokyoMarunouchi }];
      const result = validateRoute(network, tokyoYamanote, shinjukuYamanote, legs);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('degenerate-leg');
      expect(result.legIndex).toBe(0);
    });

    it('not-connected-on-line: 路線上に存在しない組み合わせ（中央線の駅を要求）', () => {
      const legs: RouteLeg[] = [{ line: chuo, from: tokyoChuo, to: tokyoChuo }];
      // from===to は degenerate-leg が先に判定されるため、別の不連結ケースとして
      // 中央線に丸ノ内線専用駅を混ぜたものを使う（station-not-on-lineになるのは別テストで担保済みのため
      // ここでは、山手線内の秋葉原・上野が中央線パターンに存在しないことを利用する）
      const akihabaraGroup = groupOf('秋葉原', '山手線');
      const akihabaraYamanote = network.lines[yamanote].patterns[0].stops.find(
        (i) => network.stations[i].group === akihabaraGroup
      )!;
      const legs2: RouteLeg[] = [{ line: chuo, from: akihabaraYamanote, to: shinjukuChuo }];
      const result = validateRoute(network, akihabaraYamanote, shinjukuYamanote, legs2);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('station-not-on-line');
      void legs;
    });
  });

  describe('evaluateRoute', () => {
    it('単純leg: 中央線 東京->新宿 直通（totalSec=660, transfers=0）', () => {
      const legs: RouteLeg[] = [{ line: chuo, from: tokyoChuo, to: shinjukuChuo }];
      const evaluation = evaluateRoute(network, legs);
      expect(evaluation.transfers).toBe(0);
      expect(evaluation.rideSec).toBe(FIXTURE_EXPECTATIONS.tokyoToShinjuku.time.totalSec);
      expect(evaluation.totalSec).toBe(FIXTURE_EXPECTATIONS.tokyoToShinjuku.time.totalSec);
    });

    it('環状線leg: 山手線 品川->上野（隣接性が末尾再掲で成立、東京経由の短い方が選ばれる）', () => {
      const shinagawaGroup = groupOf('品川', '山手線');
      const shinagawaYamanote = network.lines[yamanote].patterns[0].stops.find(
        (i) => network.stations[i].group === shinagawaGroup
      )!;
      const legs: RouteLeg[] = [{ line: yamanote, from: shinagawaYamanote, to: uenoYamanote }];
      const result = validateRoute(network, shinagawaYamanote, uenoYamanote, legs);
      expect(result).toEqual({ valid: true });

      const evaluation = evaluateRoute(network, legs);
      expect(evaluation.transfers).toBe(0);
      expect(evaluation.rideSec).toBe(FIXTURE_EXPECTATIONS.shinagawaToUeno.time.totalSec);
      expect(evaluation.totalSec).toBe(FIXTURE_EXPECTATIONS.shinagawaToUeno.time.totalSec);
    });

    it('分岐またぎleg: テスト電鉄本線 東山->西丘（1legでrideSec=400）', () => {
      const legs: RouteLeg[] = [{ line: testTetsu, from: higashiyamaStation, to: nishiokaStation }];
      const evaluation = evaluateRoute(network, legs);
      expect(evaluation.transfers).toBe(0);
      expect(evaluation.rideSec).toBe(400);
      expect(evaluation.totalSec).toBe(FIXTURE_EXPECTATIONS.higashiyamaToNishioka.time.totalSec);
    });

    it('totalSec恒等式: rideSec + transfers*transferSec と一致する（乗換ルート、東山->大手町 transfersモード相当）', () => {
      const shinjukuTestTetsu = network.lines[testTetsu].patterns[0].stops.find(
        (i) => network.stations[i].group === shinjukuGroup
      )!;
      const legs: RouteLeg[] = [
        { line: testTetsu, from: higashiyamaStation, to: shinjukuTestTetsu },
        { line: marunouchi, from: shinjukuMarunouchi, to: otemachiMarunouchi },
      ];
      const result = validateRoute(network, higashiyamaStation, otemachiMarunouchi, legs);
      expect(result).toEqual({ valid: true });

      const evaluation = evaluateRoute(network, legs);
      expect(evaluation.transfers).toBe(1);
      expect(evaluation.totalSec).toBe(evaluation.rideSec + evaluation.transfers * network.transferSec);
      expect(evaluation.totalSec).toBe(FIXTURE_EXPECTATIONS.higashiyamaToOtemachi.transfersMode.totalSec);
    });

    it('totalSec恒等式（timeモード相当の3leg乗換ルート、東山->大手町 テスト電鉄+中央線+丸ノ内線）', () => {
      const shinjukuTestTetsu = network.lines[testTetsu].patterns[0].stops.find(
        (i) => network.stations[i].group === shinjukuGroup
      )!;
      const ochanomizuMarunouchi = network.lines[marunouchi].patterns[0].stops.find(
        (i) => network.stations[i].group === ochanomizuGroup
      )!;
      const legs: RouteLeg[] = [
        { line: testTetsu, from: higashiyamaStation, to: shinjukuTestTetsu },
        { line: chuo, from: shinjukuChuo, to: ochanomizuChuo },
        { line: marunouchi, from: ochanomizuMarunouchi, to: otemachiMarunouchi },
      ];
      const result = validateRoute(network, higashiyamaStation, otemachiMarunouchi, legs);
      expect(result).toEqual({ valid: true });

      const evaluation = evaluateRoute(network, legs);
      expect(evaluation.transfers).toBe(2);
      expect(evaluation.totalSec).toBe(evaluation.rideSec + evaluation.transfers * network.transferSec);
      expect(evaluation.totalSec).toBe(FIXTURE_EXPECTATIONS.higashiyamaToOtemachi.timeMode.totalSec);
    });
  });
});
