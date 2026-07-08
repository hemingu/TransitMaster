import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../scripts/buildNetwork.ts';
import { searchRoute } from '../src/lib/raptor.ts';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { miniGtfsFeeds } from './fixtures/miniGtfs.ts';
import type { Network, RouteLeg } from '../src/lib/types.ts';
import {
  DEPART_SEC,
  buildLeg,
  difficultyToTransferRange,
  filterStationsByQuery,
  formatClock,
  formatDuration,
  formatFare,
  formatItinerary,
  formatRouteLegs,
  groupDisplayName,
  judgeAnswer,
  linesThroughStation,
  reasonMessage,
  stationDisplayName,
  stationOnLineInGroup,
  stationsOnLine,
} from '../src/lib/game.ts';

function findStationIndex(network: Network, name: string, feed: string): number {
  const idx = network.stations.findIndex((s) => s.name === name && s.feed === feed);
  if (idx === -1) throw new Error(`station not found: ${name} (${feed})`);
  return idx;
}

function findLineIndex(network: Network, name: string, feed: string): number {
  const idx = network.lines.findIndex((l) => l.name === name && l.feed === feed);
  if (idx === -1) throw new Error(`line not found: ${name} (${feed})`);
  return idx;
}

describe('formatClock', () => {
  it('9:08:00 (32880秒) を "09:08" に整形する', () => {
    expect(formatClock(DEPART_SEC)).toBe('09:08');
  });

  it('0秒を "00:00" に整形する', () => {
    expect(formatClock(0)).toBe('00:00');
  });

  it('24時を超える秒（26:30 = 25*3600+30*60）を "01:30" に整形する（24hラップ）', () => {
    expect(formatClock(25 * 3600 + 30 * 60)).toBe('01:30');
  });
});

describe('formatDuration', () => {
  it('分未満切り捨てではなく丸めで "X分" を返す', () => {
    expect(formatDuration(9 * 60)).toBe('9分');
  });

  it('60分以上は "X時間Y分" になる', () => {
    expect(formatDuration(90 * 60)).toBe('1時間30分');
  });

  it('ちょうど60分単位は "X時間" のみになる', () => {
    expect(formatDuration(120 * 60)).toBe('2時間');
  });
});

describe('formatFare', () => {
  it('数値は "X円" に整形する', () => {
    expect(formatFare(200)).toBe('200円');
  });

  it('nullは "不明" になる', () => {
    expect(formatFare(null)).toBe('不明');
  });
});

describe('difficultyToTransferRange', () => {
  it('easy は乗換ちょうど1回', () => {
    expect(difficultyToTransferRange('easy')).toEqual({ minTransfers: 1, maxTransfers: 1 });
  });

  it('normal は乗換1〜2回', () => {
    expect(difficultyToTransferRange('normal')).toEqual({ minTransfers: 1, maxTransfers: 2 });
  });

  it('hard は乗換2回以上（上限なし）', () => {
    expect(difficultyToTransferRange('hard')).toEqual({ minTransfers: 2 });
  });
});

describe('game.ts helpers with mini network', () => {
  const { network } = buildNetwork(miniGtfsFeeds());

  const tokyoJr = findStationIndex(network, '東京', 'jr');
  const tokyoMetro = findStationIndex(network, '東京', 'metro');
  const shinjukuJr = findStationIndex(network, '新宿', 'jr');
  const shinjukuMetro = findStationIndex(network, '新宿', 'metro');
  const ikebukuroJr = findStationIndex(network, '池袋', 'jr');
  const kandaJr = findStationIndex(network, '神田', 'jr');

  const yamanote = findLineIndex(network, '山手線', 'jr');
  const marunouchi = findLineIndex(network, '丸ノ内線', 'metro');

  it('stationDisplayName は駅名をそのまま返す', () => {
    expect(stationDisplayName(network, tokyoJr)).toBe('東京');
  });

  it('groupDisplayName はグループ内代表駅の名前を返す', () => {
    const group = network.stations[tokyoJr].group;
    expect(groupDisplayName(network, group)).toBe('東京');
  });

  it('linesThroughStation: 東京駅グループを通る路線には山手線と丸ノ内線が含まれる', () => {
    const lines = linesThroughStation(network, tokyoJr).map((i) => network.lines[i].name);
    expect(lines).toContain('山手線');
    expect(lines).toContain('丸ノ内線');
  });

  it('stationsOnLine: 山手線上の駅一覧から現在駅（東京）を除外できる', () => {
    const excludeGroup = network.stations[tokyoJr].group;
    const stations = stationsOnLine(network, yamanote, excludeGroup);
    const names = stations.map((s) => s.name);
    expect(names).not.toContain('東京');
    expect(names).toContain('神田');
    expect(names).toContain('池袋');
  });

  it('filterStationsByQuery: クエリでインクリメンタルに絞り込める', () => {
    const stations = stationsOnLine(network, yamanote);
    const filtered = filterStationsByQuery(stations, '神');
    expect(filtered.map((s) => s.name)).toEqual(['神田']);
  });

  it('filterStationsByQuery: 空クエリは全件返す', () => {
    const stations = stationsOnLine(network, yamanote);
    expect(filterStationsByQuery(stations, '')).toHaveLength(stations.length);
  });

  describe('stationOnLineInGroup / buildLeg（フィード跨ぎの駅indexマッピング）', () => {
    it('東京(jr) を丸ノ内線上の駅 index にマップすると 東京(metro) になる', () => {
      expect(stationOnLineInGroup(network, marunouchi, tokyoJr)).toBe(tokyoMetro);
    });

    it('路線上に存在しないグループの駅は null を返す（神田は丸ノ内線に無い）', () => {
      expect(stationOnLineInGroup(network, marunouchi, kandaJr)).toBeNull();
    });

    it('回帰: 山手線 秋葉原→東京(jr) の後に丸ノ内線を選んで新宿まで乗ると valid になる', () => {
      const akihabaraJr = findStationIndex(network, '秋葉原', 'jr');

      // UI操作の再現: 出題「秋葉原→新宿」
      // 1本目: 山手線を選択し、降車駅リスト（山手線上の駅）から東京を選ぶ
      const yamanoteCandidates = stationsOnLine(
        network,
        yamanote,
        network.stations[akihabaraJr].group
      );
      const tokyoOnYamanote = yamanoteCandidates.find((s) => s.name === '東京')!;
      expect(tokyoOnYamanote).toBeDefined();
      const leg1 = buildLeg(network, yamanote, akihabaraJr, tokyoOnYamanote.stationIdx);
      expect(leg1).not.toBeNull();

      // 現在駅は 東京(jr) の index。ここで丸ノ内線（metroフィード）を選択して新宿へ。
      const currentStation = leg1!.to;
      expect(network.stations[currentStation].feed).toBe('jr');
      const marunouchiCandidates = stationsOnLine(
        network,
        marunouchi,
        network.stations[currentStation].group
      );
      const shinjukuOnMarunouchi = marunouchiCandidates.find((s) => s.name === '新宿')!;
      expect(shinjukuOnMarunouchi).toBeDefined();
      const leg2 = buildLeg(network, marunouchi, currentStation, shinjukuOnMarunouchi.stationIdx);
      expect(leg2).not.toBeNull();

      // buildLeg が from を丸ノ内線上の 東京(metro) にマップしていること
      expect(leg2!.from).toBe(tokyoMetro);

      // 経路全体が valid と判定されること（修正前は 'station-not-on-line' で落ちていた）
      const validation = validateRoute(network, akihabaraJr, shinjukuJr, [leg1!, leg2!]);
      expect(validation).toEqual({ valid: true });
    });
  });

  describe('reasonMessage', () => {
    it('station-not-on-line: 具体的な駅名と路線名を含む', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: tokyoJr, to: shinjukuJr }];
      const msg = reasonMessage(network, legs, 'station-not-on-line', 0);
      expect(msg).toContain('新宿');
      expect(msg).toContain('山手線');
    });

    it('wrong-origin: 出発駅の食い違いを説明する', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: kandaJr, to: ikebukuroJr }];
      const msg = reasonMessage(network, legs, 'wrong-origin', 0);
      expect(msg).toContain('神田');
    });

    it('reason未指定は空文字を返す', () => {
      expect(reasonMessage(network, [], undefined, undefined)).toBe('');
    });
  });

  describe('formatRouteLegs / formatItinerary', () => {
    it('legsを路線名と駅名で連結した文字列にする', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: tokyoJr, to: kandaJr },
        { line: marunouchi, from: kandaJr, to: shinjukuJr },
      ];
      const text = formatRouteLegs(network, legs);
      expect(text).toBe('山手線 東京→神田 ｜ 丸ノ内線 神田→新宿');
    });

    it('legsが空なら代替文言を返す', () => {
      expect(formatRouteLegs(network, [])).toBe('（まだ経路がありません）');
    });

    it('formatItinerary は Itinerary.legs を同じ形式に整形する', () => {
      const itinerary = searchRoute(network, tokyoJr, shinjukuJr, DEPART_SEC, 'transfers')!;
      expect(itinerary).not.toBeNull();
      expect(formatItinerary(network, itinerary)).toBe(formatRouteLegs(network, itinerary.legs));
    });
  });

  describe('judgeAnswer: 東京->新宿の判定ロジック', () => {
    // raptor.test.ts と同じ DEPART_SEC(9:08発) を用いる。
    // 丸ノ内線直通(乗換0・170円・9:36着)が mode=transfers/fare の模範解答、
    // 丸ノ内線->中央線の乗換1回(9:26着)が mode=time の模範解答になる。

    it('丸ノ内線直通で回答すると、transfersモードでパーフェクト判定になる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      const validation = validateRoute(network, tokyoJr, shinjukuJr, legs);
      expect(validation.valid).toBe(true);

      const evaluation = evaluateRoute(network, legs, DEPART_SEC);
      const reference = searchRoute(network, tokyoJr, shinjukuJr, DEPART_SEC, 'transfers');
      expect(reference).not.toBeNull();
      expect(reference!.transfers).toBe(0);

      const judgement = judgeAnswer('transfers', evaluation, reference);
      expect(judgement.level).toBe('perfect');
    });

    it('丸ノ内線直通で回答すると、fareモードでもパーフェクト判定になる（同額170円）', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      const evaluation = evaluateRoute(network, legs, DEPART_SEC);
      const reference = searchRoute(network, tokyoJr, shinjukuJr, DEPART_SEC, 'fare');

      const judgement = judgeAnswer('fare', evaluation, reference);
      expect(judgement.level).toBe('perfect');
      expect(evaluation.fare).toBe(170);
    });

    it('丸ノ内線直通で回答すると、timeモードでは模範解答（乗換1回・17分）より遅いため perfect にならない', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      const evaluation = evaluateRoute(network, legs, DEPART_SEC);
      const reference = searchRoute(network, tokyoJr, shinjukuJr, DEPART_SEC, 'time');
      expect(reference).not.toBeNull();

      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('good');
      expect(judgement.message).toContain('模範解答');
    });

    it('乗換ルート（丸ノ内線->中央線）で回答すると、timeモードでパーフェクト判定になる', () => {
      const ochanomizuMetro = findStationIndex(network, '御茶ノ水', 'metro');
      const ochanomizuJr = findStationIndex(network, '御茶ノ水', 'jr');
      const chuo = findLineIndex(network, '中央線', 'jr');

      const legs: RouteLeg[] = [
        { line: marunouchi, from: tokyoMetro, to: ochanomizuMetro },
        { line: chuo, from: ochanomizuJr, to: shinjukuJr },
      ];
      const validation = validateRoute(network, tokyoJr, shinjukuJr, legs);
      expect(validation.valid).toBe(true);

      const evaluation = evaluateRoute(network, legs, DEPART_SEC);
      const reference = searchRoute(network, tokyoJr, shinjukuJr, DEPART_SEC, 'time');
      expect(reference).not.toBeNull();
      expect(reference!.transfers).toBe(1);

      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('perfect');
    });

    it('回帰: 模範解答と完全に同一の経路なら timeモードで必ずパーフェクトになる（秋葉原→御茶ノ水）', () => {
      // 修正前: プレイヤー側の所要時間は DEPART_SEC(9:08)起点（初回の列車待ち込み）、
      // 模範解答側は arrive - depart（実乗車時刻起点、待ちなし）で基準がずれており、
      // 同一経路でも「±10%以内」を満たせずパーフェクトを逃していた。
      const akihabaraJr = findStationIndex(network, '秋葉原', 'jr');
      const ochanomizuJr = findStationIndex(network, '御茶ノ水', 'jr');

      const reference = searchRoute(network, akihabaraJr, ochanomizuJr, DEPART_SEC, 'time');
      expect(reference).not.toBeNull();

      // 模範解答とまったく同じ legs で回答する
      const legs: RouteLeg[] = reference!.legs.map((l) => ({
        line: l.line,
        from: l.from,
        to: l.to,
      }));
      const validation = validateRoute(network, akihabaraJr, ochanomizuJr, legs);
      expect(validation.valid).toBe(true);

      const evaluation = evaluateRoute(network, legs, DEPART_SEC);
      // 同一経路なら到着時刻も一致するはず
      expect(evaluation.arriveSec).toBe(reference!.arrive);

      const judgement = judgeAnswer('time', evaluation, reference, DEPART_SEC);
      expect(judgement.level).toBe('perfect');
    });

    it('模範解答が見つからない場合は good 判定になる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMetro, to: shinjukuMetro }];
      const evaluation = evaluateRoute(network, legs, DEPART_SEC);
      const judgement = judgeAnswer('transfers', evaluation, null);
      expect(judgement.level).toBe('good');
    });
  });
});
