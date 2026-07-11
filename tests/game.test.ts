import { describe, expect, it } from 'vitest';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { filterOptions } from '../src/lib/autocomplete.ts';
import { miniNetwork } from './fixtures/miniEkidata.ts';
import type { Itinerary, Network, RouteLeg } from '../src/lib/types.ts';
import {
  buildLeg,
  buildLineOptions,
  buildStationOptions,
  difficultyToTransferRange,
  filterStationsByQuery,
  formatDuration,
  formatEstimatedDuration,
  formatItinerary,
  formatLineName,
  formatRouteLegs,
  groupDisplayName,
  judgeAnswer,
  linesThroughStation,
  reasonMessage,
  stationDisplayName,
  stationOnLineInGroup,
  stationsOnLine,
} from '../src/lib/game.ts';

function findLineIndex(network: Network, name: string): number {
  const idx = network.lines.findIndex((l) => l.name === name);
  if (idx === -1) throw new Error(`line not found: ${name}`);
  return idx;
}

function stationOnLine(network: Network, lineIdx: number, name: string): number {
  const line = network.lines[lineIdx];
  for (const pattern of line.patterns) {
    for (const stopIdx of pattern.stops) {
      if (network.stations[stopIdx].name === name) return stopIdx;
    }
  }
  throw new Error(`station ${name} not found on line ${lineIdx}`);
}

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

describe('formatEstimatedDuration', () => {
  it('59分は「約59分（推定）」になる（60分未満の境界）', () => {
    expect(formatEstimatedDuration(59 * 60)).toBe('約59分（推定）');
  });

  it('60分ちょうどは「約1時間（推定）」になる（60分の境界）', () => {
    expect(formatEstimatedDuration(60 * 60)).toBe('約1時間（推定）');
  });

  it('60分超（65分）は「約1時間5分（推定）」になる', () => {
    expect(formatEstimatedDuration(65 * 60)).toBe('約1時間5分（推定）');
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

describe('game.ts helpers with miniNetwork', () => {
  const network = miniNetwork();

  const yamanote = findLineIndex(network, '山手線');
  const chuo = findLineIndex(network, '中央線');
  const marunouchi = findLineIndex(network, '丸ノ内線');

  const tokyoYamanote = stationOnLine(network, yamanote, '東京');
  const tokyoMarunouchi = stationOnLine(network, marunouchi, '東京');
  const shinjukuYamanote = stationOnLine(network, yamanote, '新宿');
  const shinjukuMarunouchi = stationOnLine(network, marunouchi, '新宿');
  const shinjukuChuo = stationOnLine(network, chuo, '新宿');
  const ikebukuroYamanote = stationOnLine(network, yamanote, '池袋');
  const kandaYamanote = stationOnLine(network, yamanote, '神田');
  const akihabaraYamanote = stationOnLine(network, yamanote, '秋葉原');

  it('stationDisplayName は駅名をそのまま返す', () => {
    expect(stationDisplayName(network, tokyoYamanote)).toBe('東京');
  });

  it('groupDisplayName はグループ内代表駅の名前を返す', () => {
    const group = network.stations[tokyoYamanote].group;
    expect(groupDisplayName(network, group)).toBe('東京');
  });

  it('formatLineName: 路線名（事業者名）の形式になる', () => {
    expect(formatLineName(network, marunouchi)).toBe('丸ノ内線（東京メトロ）');
    expect(formatLineName(network, yamanote)).toBe('山手線（JR東日本）');
  });

  it('linesThroughStation: 東京駅グループを通る路線には山手線と丸ノ内線が含まれる', () => {
    const lines = linesThroughStation(network, tokyoYamanote).map((i) => network.lines[i].name);
    expect(lines).toContain('山手線');
    expect(lines).toContain('丸ノ内線');
  });

  it('stationsOnLine: 山手線上の駅一覧から現在駅（東京）を除外できる', () => {
    const excludeGroup = network.stations[tokyoYamanote].group;
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

  describe('stationOnLineInGroup / buildLeg（路線レコード跨ぎの駅indexマッピング）', () => {
    it('東京(山手線) を丸ノ内線上の駅 index にマップすると 東京(丸ノ内線) になる', () => {
      expect(stationOnLineInGroup(network, marunouchi, tokyoYamanote)).toBe(tokyoMarunouchi);
    });

    it('路線上に存在しないグループの駅は null を返す（神田は丸ノ内線に無い）', () => {
      expect(stationOnLineInGroup(network, marunouchi, kandaYamanote)).toBeNull();
    });

    it('回帰: 山手線 東京→(降車後)丸ノ内線に乗る際、丸ノ内線上の東京レコードへマップされる', () => {
      // UI操作の再現: 出題「秋葉原→新宿」
      // 1本目: 山手線を選択し、降車駅リスト（山手線上の駅）から東京を選ぶ
      const yamanoteCandidates = stationsOnLine(
        network,
        yamanote,
        network.stations[akihabaraYamanote].group
      );
      const tokyoOnYamanote = yamanoteCandidates.find((s) => s.name === '東京')!;
      expect(tokyoOnYamanote).toBeDefined();
      const leg1 = buildLeg(network, yamanote, akihabaraYamanote, tokyoOnYamanote.stationIdx);
      expect(leg1).not.toBeNull();

      // 現在駅は 東京(山手線) の index。ここで丸ノ内線を選択して新宿へ。
      const currentStation = leg1!.to;
      expect(currentStation).toBe(tokyoYamanote);
      const marunouchiCandidates = stationsOnLine(
        network,
        marunouchi,
        network.stations[currentStation].group
      );
      const shinjukuOnMarunouchi = marunouchiCandidates.find((s) => s.name === '新宿')!;
      expect(shinjukuOnMarunouchi).toBeDefined();
      const leg2 = buildLeg(network, marunouchi, currentStation, shinjukuOnMarunouchi.stationIdx);
      expect(leg2).not.toBeNull();

      // buildLeg が from を丸ノ内線上の 東京(丸ノ内線) にマップしていること
      expect(leg2!.from).toBe(tokyoMarunouchi);

      // 経路全体が valid と判定されること（修正前は 'station-not-on-line' で落ちていた）
      const validation = validateRoute(network, akihabaraYamanote, shinjukuYamanote, [leg1!, leg2!]);
      expect(validation).toEqual({ valid: true });
    });

    it('フォールバック: 路線上にない駅はマップせず元の駅indexをそのまま使う', () => {
      // 神田は丸ノ内線に無い。全駅候補UIでは路線上にない駅も選べるため、
      // buildLeg は即時エラーにせず元の index を残した leg を返す。
      const leg = buildLeg(network, marunouchi, tokyoYamanote, kandaYamanote);
      expect(leg.line).toBe(marunouchi);
      // from は丸ノ内線上の東京レコードへマップされる（同一グループ内に存在するため）
      expect(leg.from).toBe(tokyoMarunouchi);
      // to はマップ不能なので元の index のまま
      expect(leg.to).toBe(kandaYamanote);
    });

    it('フォールバック leg は回答時に validateRoute が station-not-on-line で弾く', () => {
      const leg = buildLeg(network, marunouchi, tokyoYamanote, kandaYamanote);
      const validation = validateRoute(network, tokyoYamanote, kandaYamanote, [leg]);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('station-not-on-line');
      expect(validation.legIndex).toBe(0);
    });

    it('フォールバック: from/to とも路線上に無い場合も両方とも元の index を保つ', () => {
      // 神田・秋葉原はどちらも丸ノ内線に無い
      const leg = buildLeg(network, marunouchi, kandaYamanote, akihabaraYamanote);
      expect(leg).toEqual({ line: marunouchi, from: kandaYamanote, to: akihabaraYamanote });
      const validation = validateRoute(network, kandaYamanote, akihabaraYamanote, [leg]);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('station-not-on-line');
    });
  });

  describe('buildLineOptions（路線オートコンプリート候補）', () => {
    const options = buildLineOptions(network);

    it('全路線が候補になり、labelは「路線名（事業者名）」形式', () => {
      expect(options.length).toBe(network.lines.length);
      const yamanoteOpt = options.find((o) => o.label === '山手線（JR東日本）');
      expect(yamanoteOpt).toBeDefined();
      expect(yamanoteOpt!.badge).toEqual({ name: '山手線', company: 'JR東日本', color: '9ACD32' });
    });

    it('カナ（カタカナ）でヒットする', () => {
      const result = filterOptions(options, 'ヤマノテ');
      expect(result.map((o) => o.label)).toContain('山手線（JR東日本）');
    });

    it('ひらがな入力でもヒットする（searchTextにカタカナ→ひらがな変換を連結済み）', () => {
      const result = filterOptions(options, 'やまのてせん');
      expect(result.map((o) => o.label)).toContain('山手線（JR東日本）');
    });

    it('カナ未収録の路線は路線名のみで検索できる', () => {
      const result = filterOptions(options, '中央');
      expect(result.map((o) => o.label)).toContain('中央線（JR東日本）');
    });
  });

  describe('buildStationOptions（駅オートコンプリート候補）', () => {
    const options = buildStationOptions(network);

    it('グループ（物理駅）単位で重複排除される', () => {
      const uniqueGroups = new Set(network.stations.map((s) => s.group));
      expect(options.length).toBe(uniqueGroups.size);
      // 東京は3レコードあるが候補は1つ
      expect(options.filter((o) => o.label === '東京').length).toBe(1);
    });

    it('カナ（カタカナ・ひらがな）でヒットする', () => {
      expect(filterOptions(options, 'トウキョウ').map((o) => o.label)).toContain('東京');
      expect(filterOptions(options, 'とうきょう').map((o) => o.label)).toContain('東京');
    });

    it('駅名が一意なら note（都道府県名）は付かない', () => {
      // miniNetworkの駅名はグループ単位ではすべて一意
      for (const o of options) {
        expect(o.note).toBeUndefined();
      }
    });

    it('同名別駅（複数グループに同じ駅名）のみ note に都道府県名が付く', () => {
      // 大阪の京橋(pref=27)と東京の京橋(pref=13)、一意な桜島、pref不明(0)の同名駅ペア
      const dupNetwork: Network = {
        formatVersion: 2,
        stations: [
          { name: '京橋', lat: 34.6966, lon: 135.5344, group: 0, pref: 27 },
          { name: '京橋', lat: 35.6767, lon: 139.7701, group: 1, pref: 13 },
          { name: '桜島', lat: 34.6656, lon: 135.4384, group: 2, pref: 27 },
          { name: '謎駅', lat: 0, lon: 0, group: 3, pref: 0 },
          { name: '謎駅', lat: 1, lon: 1, group: 4, pref: 13 },
        ],
        lines: [],
        transferSec: 300,
      };
      const dupOptions = buildStationOptions(dupNetwork);

      const kyobashi = dupOptions.filter((o) => o.label === '京橋');
      expect(kyobashi.map((o) => o.note)).toEqual(['大阪府', '東京都']);

      // 一意な駅名は note なし
      expect(dupOptions.find((o) => o.label === '桜島')!.note).toBeUndefined();

      // 同名でも pref=0（不明）の方は note をスキップ、判明している方のみ表示
      const nazo = dupOptions.filter((o) => o.label === '謎駅');
      expect(nazo[0].note).toBeUndefined();
      expect(nazo[1].note).toBe('東京都');
    });
  });

  describe('reasonMessage', () => {
    it('station-not-on-line: 具体的な駅名と路線名（事業者名込み）を含む', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: tokyoYamanote, to: shinjukuChuo }];
      const msg = reasonMessage(network, legs, 'station-not-on-line', 0);
      expect(msg).toContain('新宿');
      expect(msg).toContain('山手線（JR東日本）');
    });

    it('wrong-origin: 出発駅の食い違いを説明する', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: kandaYamanote, to: ikebukuroYamanote }];
      const msg = reasonMessage(network, legs, 'wrong-origin', 0);
      expect(msg).toContain('神田');
    });

    it('reason未指定は空文字を返す', () => {
      expect(reasonMessage(network, [], undefined, undefined)).toBe('');
    });
  });

  describe('formatRouteLegs / formatItinerary', () => {
    it('legsを路線名（事業者名込み）と駅名で連結した文字列にする', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: tokyoYamanote, to: kandaYamanote },
        { line: marunouchi, from: tokyoMarunouchi, to: shinjukuMarunouchi },
      ];
      const text = formatRouteLegs(network, legs);
      expect(text).toBe(
        '山手線（JR東日本） 東京→神田 ｜ 丸ノ内線（東京メトロ） 東京→新宿'
      );
    });

    it('legsが空なら代替文言を返す', () => {
      expect(formatRouteLegs(network, [])).toBe('（まだ経路がありません）');
    });

    it('formatItinerary は Itinerary.legs を同じ形式に整形する', () => {
      const legs = [{ line: marunouchi, from: tokyoMarunouchi, to: shinjukuMarunouchi, rideSec: 1200 }];
      const itinerary: Itinerary = { legs, rideSec: 1200, totalSec: 1200, transfers: 0 };
      expect(formatItinerary(network, itinerary)).toBe(formatRouteLegs(network, itinerary.legs));
    });
  });

  describe('judgeAnswer: time モード', () => {
    const reference: Itinerary = {
      legs: [],
      rideSec: 1000,
      totalSec: 1000,
      transfers: 0,
    };

    it('模範解答と同じ所要時間（ratio=1.0）は perfect になる', () => {
      const evaluation = { transfers: 0, rideSec: 1000, totalSec: 1000 };
      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('perfect');
      expect(judgement.message).toContain('パーフェクト');
      expect(judgement.message).toContain(formatEstimatedDuration(reference.totalSec));
    });

    it('模範解答より短い（ratio<1.0）場合も perfect になる', () => {
      const evaluation = { transfers: 0, rideSec: 900, totalSec: 900 };
      expect(judgeAnswer('time', evaluation, reference).level).toBe('perfect');
    });

    it('1.05倍は close（おしい）になり、超過率を含む', () => {
      const evaluation = { transfers: 0, rideSec: 1050, totalSec: 1050 };
      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('close');
      expect(judgement.message).toContain('おしい');
      expect(judgement.message).toContain('約5%');
      expect(judgement.message).toContain(formatEstimatedDuration(reference.totalSec));
    });

    it('ちょうど1.1倍は close になる（境界は close 側）', () => {
      const evaluation = { transfers: 0, rideSec: 1100, totalSec: 1100 };
      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('close');
      expect(judgement.message).toContain('約10%');
    });

    it('1.11倍は miss（不正解）になる', () => {
      const evaluation = { transfers: 0, rideSec: 1110, totalSec: 1110 };
      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('miss');
      expect(judgement.message).toContain('不正解');
      expect(judgement.message).toContain('約11%');
      expect(judgement.message).toContain(formatEstimatedDuration(reference.totalSec));
    });

    it('僅かな超過でも超過率は最低1%と表示される', () => {
      // ratio = 1.001 -> Math.round((ratio-1)*100) = 0 だが最低1%に切り上げ
      const evaluation = { transfers: 0, rideSec: 1001, totalSec: 1001 };
      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('close');
      expect(judgement.message).toContain('約1%');
    });

    it('evaluationのtotalSecがnullなら miss になる', () => {
      const evaluation = { transfers: 0, rideSec: 0, totalSec: null };
      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('miss');
      expect(judgement.message).toContain('所要時間を算出できませんでした');
      expect(judgement.message).toContain(formatEstimatedDuration(reference.totalSec));
    });
  });

  describe('judgeAnswer: transfers モード', () => {
    it('同数（diff=0）なら perfect になる', () => {
      const reference: Itinerary = { legs: [], rideSec: 0, totalSec: 0, transfers: 1 };
      const evaluation = { transfers: 1, rideSec: 0, totalSec: 0 };
      const judgement = judgeAnswer('transfers', evaluation, reference);
      expect(judgement.level).toBe('perfect');
      expect(judgement.message).toContain('乗換1回');
    });

    it('模範解答より少なければ（diff<0）perfect になる', () => {
      const reference: Itinerary = { legs: [], rideSec: 0, totalSec: 0, transfers: 2 };
      const evaluation = { transfers: 1, rideSec: 0, totalSec: 0 };
      const judgement = judgeAnswer('transfers', evaluation, reference);
      expect(judgement.level).toBe('perfect');
    });

    it('1回多い（diff=1）なら close になる', () => {
      const reference: Itinerary = { legs: [], rideSec: 0, totalSec: 0, transfers: 1 };
      const evaluation = { transfers: 2, rideSec: 0, totalSec: 0 };
      const judgement = judgeAnswer('transfers', evaluation, reference);
      expect(judgement.level).toBe('close');
      expect(judgement.message).toContain('おしい');
      expect(judgement.message).toContain('乗換1回');
    });

    it('2回以上多い（diff>=2）なら miss になる', () => {
      const reference: Itinerary = { legs: [], rideSec: 0, totalSec: 0, transfers: 0 };
      const evaluation = { transfers: 2, rideSec: 0, totalSec: 0 };
      const judgement = judgeAnswer('transfers', evaluation, reference);
      expect(judgement.level).toBe('miss');
      expect(judgement.message).toContain('不正解');
      expect(judgement.message).toContain('乗換0回');
    });
  });

  describe('judgeAnswer: reference が null', () => {
    it('modeによらず perfect 扱いになる', () => {
      const evaluation = { transfers: 3, rideSec: 999, totalSec: 999 };
      const transfersJudgement = judgeAnswer('transfers', evaluation, null);
      const timeJudgement = judgeAnswer('time', evaluation, null);
      expect(transfersJudgement.level).toBe('perfect');
      expect(timeJudgement.level).toBe('perfect');
      expect(timeJudgement.message).toContain('模範解答が見つからなかった');
    });
  });

  describe('evaluateRouteとの結合（実ネットワーク上での判定）', () => {
    it('丸ノ内線直通で回答すると、transfersモードでパーフェクト判定になる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMarunouchi, to: shinjukuMarunouchi }];
      const validation = validateRoute(network, tokyoYamanote, shinjukuYamanote, legs);
      expect(validation.valid).toBe(true);

      const evaluation = evaluateRoute(network, legs);
      const reference: Itinerary = { legs: [], rideSec: 660, totalSec: 660, transfers: 0 };

      const judgement = judgeAnswer('transfers', evaluation, reference);
      expect(judgement.level).toBe('perfect');
    });

    it('丸ノ内線直通で回答すると、timeモードでは中央線直通の模範解答(660秒)の1.1倍超のため miss になる', () => {
      const legs: RouteLeg[] = [{ line: marunouchi, from: tokyoMarunouchi, to: shinjukuMarunouchi }];
      const evaluation = evaluateRoute(network, legs);
      // 丸ノ内線直通は1200秒 = 模範解答660秒の約1.8倍
      const reference: Itinerary = { legs: [], rideSec: 660, totalSec: 660, transfers: 0 };

      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('miss');
      expect(judgement.message).toContain('不正解');
      expect(judgement.message).toContain('模範解答');
    });
  });
});
