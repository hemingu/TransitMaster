import { describe, expect, it } from 'vitest';
import { evaluateRoute, validateRoute } from '../src/lib/validate.ts';
import { filterOptions, type AutocompleteOption } from '../src/lib/autocomplete.ts';
import { COMPANY_READINGS } from '../src/lib/companyReadings.ts';
import { searchRoute } from '../src/lib/raptor.ts';
import { miniNetwork } from './fixtures/miniMt3d.ts';
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

/** 路線の駅レコード（station index）を駅名で探す。 */
function stationOnLine(network: Network, lineIdx: number, name: string): number {
  const idx = network.stations.findIndex((s) => s.line === lineIdx && s.name === name);
  if (idx === -1) throw new Error(`station ${name} not found on line ${lineIdx}`);
  return idx;
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
  it('59分は「約59分」になる（60分未満の境界）', () => {
    expect(formatEstimatedDuration(59 * 60)).toBe('約59分');
  });

  it('60分ちょうどは「約1時間」になる（60分の境界）', () => {
    expect(formatEstimatedDuration(60 * 60)).toBe('約1時間');
  });

  it('60分超（65分）は「約1時間5分」になる', () => {
    expect(formatEstimatedDuration(65 * 60)).toBe('約1時間5分');
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

describe('game.ts helpers with miniNetwork (MT3Dフィクスチャ)', () => {
  const network = miniNetwork();

  const yamanote = findLineIndex(network, '山手線');
  const chuo = findLineIndex(network, '中央線');
  const fukutoshin = findLineIndex(network, '副都心線');
  const toyoko = findLineIndex(network, '東横線');
  const minatomirai = findLineIndex(network, 'みなとみらい線');

  const tokyoYamanote = stationOnLine(network, yamanote, '東京');
  const tokyoChuo = stationOnLine(network, chuo, '東京');
  const shinjukuYamanote = stationOnLine(network, yamanote, '新宿');
  const shinjukuChuo = stationOnLine(network, chuo, '新宿');
  const uenoYamanote = stationOnLine(network, yamanote, '上野');
  const shibuyaFuku = stationOnLine(network, fukutoshin, '渋谷');
  const shibuyaToyoko = stationOnLine(network, toyoko, '渋谷');
  const yokohamaToyoko = stationOnLine(network, toyoko, '横浜');
  const yokohamaMina = stationOnLine(network, minatomirai, '横浜');
  const ikebukuroFuku = stationOnLine(network, fukutoshin, '池袋');

  it('stationDisplayName は駅名をそのまま返す', () => {
    expect(stationDisplayName(network, tokyoYamanote)).toBe('東京');
  });

  it('groupDisplayName はグループ内代表駅の名前を返す', () => {
    const group = network.stations[tokyoYamanote].group;
    expect(groupDisplayName(network, group)).toBe('東京');
  });

  it('formatLineName: 路線名（事業者名）の形式になる', () => {
    expect(formatLineName(network, fukutoshin)).toBe('副都心線（東京メトロ）');
    expect(formatLineName(network, yamanote)).toBe('山手線（JR東日本）');
  });

  it('linesThroughStation: 東京駅グループ（alternateで統合）を通る路線には山手線と中央線が含まれる', () => {
    const lines = linesThroughStation(network, tokyoYamanote).map((i) => network.lines[i].name);
    expect(lines).toContain('山手線');
    expect(lines).toContain('中央線');
  });

  it('stationsOnLine: 山手線上の駅一覧から現在駅（東京）を除外できる', () => {
    const excludeGroup = network.stations[tokyoYamanote].group;
    const stations = stationsOnLine(network, yamanote, excludeGroup);
    const names = stations.map((s) => s.name);
    expect(names).not.toContain('東京');
    expect(names).toContain('上野');
    expect(names).toContain('品川');
  });

  it('filterStationsByQuery: クエリでインクリメンタルに絞り込める', () => {
    const stations = stationsOnLine(network, yamanote);
    const filtered = filterStationsByQuery(stations, '上');
    expect(filtered.map((s) => s.name)).toEqual(['上野']);
  });

  it('filterStationsByQuery: 空クエリは全件返す', () => {
    const stations = stationsOnLine(network, yamanote);
    expect(filterStationsByQuery(stations, '')).toHaveLength(stations.length);
  });

  describe('stationOnLineInGroup / buildLeg（路線レコード跨ぎの駅indexマッピング）', () => {
    it('渋谷（副都心線）と同グループの東横線の駅レコードにマップされる', () => {
      expect(stationOnLineInGroup(network, toyoko, shibuyaFuku)).toBe(shibuyaToyoko);
      expect(stationOnLineInGroup(network, fukutoshin, shibuyaToyoko)).toBe(shibuyaFuku);
    });

    it('路線上に同グループの駅がなければ null', () => {
      expect(stationOnLineInGroup(network, minatomirai, shibuyaFuku)).toBeNull();
    });

    it('buildLeg: from/to を選択路線上の駅レコードに揃える', () => {
      const leg = buildLeg(network, toyoko, shibuyaFuku, yokohamaMina);
      expect(leg).toEqual({ line: toyoko, from: shibuyaToyoko, to: yokohamaToyoko });
    });

    it('buildLeg: 路線上にない駅はそのままの index を使う（validateRoute が弾く）', () => {
      const leg = buildLeg(network, minatomirai, shibuyaFuku, ikebukuroFuku);
      expect(leg.from).toBe(shibuyaFuku);
      expect(leg.to).toBe(ikebukuroFuku);
    });
  });

  describe('buildLineOptions（路線オートコンプリート候補）', () => {
    const options = buildLineOptions(network);

    it('全路線が候補になる（除外された路線は含まれない）', () => {
      expect(options).toHaveLength(network.lines.length);
      expect(options.map((o) => o.label)).not.toContain('小田原線（小田急電鉄）');
    });

    it('label は「路線名（事業者名）」、badge に色が入る', () => {
      const opt = options.find((o) => o.id === yamanote)!;
      expect(opt.label).toBe('山手線（JR東日本）');
      expect(opt.badge).toEqual({ name: '山手線', company: 'JR東日本', color: '9ACD32' });
    });

    it('日本語・ローマ字・ひらがな・カタカナで同じ路線にヒットする', () => {
      for (const q of ['山手', 'yamanote', 'やまのて', 'ヤマノテ']) {
        expect(filterOptions(options, q).map((o) => o.id)).toContain(yamanote);
      }
    });

    it('東横線は「とうよこ」「toyoko」「touyoko」でヒットする（長音の揺れ: ou -> o）', () => {
      for (const q of ['とうよこ', 'toyoko', 'touyoko']) {
        expect(filterOptions(options, q).map((o) => o.id)).toContain(toyoko);
      }
    });
  });

  describe('事業者名検索（路線候補）', () => {
    const options = buildLineOptions(network);
    const companyOf = (id: number) => network.lines[id].company;
    const hit = (q: string) => filterOptions(options, q).map((o) => companyOf(o.id));

    it('空入力・空白のみでは候補が出ない', () => {
      expect(filterOptions(options, '')).toEqual([]);
      expect(filterOptions(options, '   ')).toEqual([]);
    });

    it('東急: とうきゅう・トウキュウ・東急・tokyu で東急電鉄の路線がヒットする', () => {
      for (const q of ['とうきゅう', 'トウキュウ', '東急', 'tokyu', 'toukyuu']) {
        expect(hit(q), q).toContain('東急電鉄');
      }
    });

    it('東急と東京は区別される（tokyu と tokyo）', () => {
      expect(hit('とうきゅう')).not.toContain('東京メトロ');
      expect(hit('とうきょう')).not.toContain('東急電鉄');
      expect(hit('とうきょうめとろ')).toContain('東京メトロ');
      expect(hit('とうきょうめとろ')).not.toContain('東急電鉄');
    });

    it('各事業者の読み・略称・英字でヒットする（fixture に存在する事業者のみ）', () => {
      const cases: [string, string][] = [
        ['めとろ', '東京メトロ'],
        ['メトロ', '東京メトロ'],
        ['とえい', '都営地下鉄'],
        ['都営', '都営地下鉄'],
        ['じぇいあーる', 'JR東日本'],
        ['JR', 'JR東日本'],
        ['けいせい', '京成電鉄'],
        ['けいきゅう', '京急電鉄'],
        ['京急', '京急電鉄'],
        ['けいおう', '京王電鉄'],
        ['せいぶ', '西武鉄道'],
        ['とうぶ', '東武鉄道'],
        ['そうてつ', '相模鉄道'],
        ['相鉄', '相模鉄道'],
        ['おだきゅう', '小田急電鉄'],
        ['オダキュウ', '小田急電鉄'],
        ['小田急', '小田急電鉄'],
        ['odakyu', '小田急電鉄'],
      ];
      for (const [q, company] of cases) {
        if (network.lines.some((l) => l.company === company)) {
          expect(hit(q), q).toContain(company);
        }
      }
    });

    it('路線名自体の前方一致は事業者名のみのヒットより前に並ぶ', () => {
      const list: AutocompleteOption[] = [
        { id: 1, label: 'A線（東急電鉄）', searchText: 'A線（東急電鉄）', romaji: 'aline|tokyu' },
        { id: 2, label: 'とうきゅう線', searchText: 'とうきゅう線', romaji: 'tokyuline' },
      ];
      expect(filterOptions(list, 'とうきゅう').map((o) => o.id)).toEqual([2, 1]);
    });

    it('network.json の全事業者が読みテーブルに登録され、実データで事業者の全路線がヒットする', async () => {
      const { readFileSync } = await import('node:fs');
      const data = JSON.parse(readFileSync('public/data/network.json', 'utf8')) as Network;
      const real = buildLineOptions(data);
      for (const c of new Set(data.lines.map((l) => l.company))) {
        expect(COMPANY_READINGS[c], c).toBeDefined();
      }
      const ids = (q: string) => filterOptions(real, q, 1000).map((o) => data.lines[o.id].company);
      const odakyu = data.lines.filter((l) => l.company === '小田急電鉄').length;
      for (const q of ['おだきゅう', 'オダキュウ', '小田急', 'odakyu']) {
        expect(ids(q).filter((c) => c === '小田急電鉄')).toHaveLength(odakyu);
      }
      expect(ids('とうきゅう')).toContain('東急電鉄');
      expect(ids('とうきゅう')).not.toContain('東京メトロ');
    });
  });

  describe('buildStationOptions（駅オートコンプリート候補）', () => {
    const options = buildStationOptions(network);

    it('物理駅（グループ）× 駅名 で重複排除される', () => {
      const names = options.map((o) => o.label);
      // 東京は山手線・中央線で1件、渋谷・横浜も1件
      expect(names.filter((n) => n === '東京')).toHaveLength(1);
      expect(names.filter((n) => n === '渋谷')).toHaveLength(1);
      expect(names.filter((n) => n === '横浜')).toHaveLength(1);
    });

    it('同一グループでも駅名が違えば別候補（新宿 / 新宿三丁目 / 新宿西口）', () => {
      const names = options.map((o) => o.label);
      expect(names).toContain('新宿');
      expect(names).toContain('新宿三丁目');
      expect(names).toContain('新宿西口');
      const groups = ['新宿', '新宿三丁目', '新宿西口'].map(
        (n) => network.stations[options.find((o) => o.label === n)!.id].group
      );
      expect(new Set(groups).size).toBe(1);
    });

    it('ひらがな・カタカナ・ローマ字で駅にヒットする', () => {
      const ids = (q: string) => filterOptions(options, q).map((o) => network.stations[o.id].name);
      for (const q of ['しぶや', 'シブヤ', 'shibuya', 'SHIBUYA']) {
        expect(ids(q)).toContain('渋谷');
      }
      for (const q of ['しんじゅく', 'シンジュク', 'shinjuku']) {
        expect(ids(q)).toContain('新宿');
      }
    });

    it('同名別グループがなければ note は付かない', () => {
      expect(options.every((o) => o.note === undefined)).toBe(true);
    });

    it('同名の駅が複数グループにある場合は乗り入れ路線名の note で区別される', () => {
      const dup: Network = {
        ...network,
        stations: [
          ...network.stations,
          // 渋谷と同名だが別グループ（別の場所）のダミー駅
          { name: '渋谷', en: 'Shibuya', lat: 35, lon: 139, group: 9999, line: toyoko },
        ],
      };
      const opts = buildStationOptions(dup).filter((o) => o.label === '渋谷');
      expect(opts).toHaveLength(2);
      expect(opts.every((o) => typeof o.note === 'string' && o.note.length > 0)).toBe(true);
      expect(opts[1].note).toBe('東横線（東急電鉄）');
      expect(opts[0].note).toContain('ほか');
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
      const legs: RouteLeg[] = [{ line: yamanote, from: uenoYamanote, to: shinjukuYamanote }];
      const msg = reasonMessage(network, legs, 'wrong-origin', 0);
      expect(msg).toContain('上野');
    });

    it('reason未指定は空文字を返す', () => {
      expect(reasonMessage(network, [], undefined, undefined)).toBe('');
    });
  });

  describe('formatRouteLegs / formatItinerary', () => {
    it('legsを路線名（事業者名込み）と駅名で連結した文字列にする', () => {
      const legs: RouteLeg[] = [
        { line: yamanote, from: tokyoYamanote, to: uenoYamanote },
        { line: chuo, from: tokyoChuo, to: shinjukuChuo },
      ];
      expect(formatRouteLegs(network, legs)).toBe(
        '山手線（JR東日本） 東京→上野 ｜ 中央線（JR東日本） 東京→新宿'
      );
    });

    it('through 付きの区間（直通運転）は「直通」でつなぐ', () => {
      const legs = [
        { line: fukutoshin, from: ikebukuroFuku, to: shibuyaFuku },
        { line: toyoko, from: shibuyaToyoko, to: yokohamaToyoko, through: true },
      ];
      const text = formatRouteLegs(network, legs);
      expect(text).toBe(
        '副都心線（東京メトロ） 池袋→渋谷 ＝直通＝ 東横線（東急電鉄） 渋谷→横浜'
      );
    });

    it('legsが空なら代替文言を返す', () => {
      expect(formatRouteLegs(network, [])).toBe('（まだ経路がありません）');
    });

    it('formatItinerary は Itinerary.legs を同じ形式に整形する', () => {
      const legs = [{ line: chuo, from: tokyoChuo, to: shinjukuChuo, rideSec: 840 }];
      const itinerary: Itinerary = { legs, rideSec: 840, totalSec: 840, transfers: 0 };
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
    it('山手線で回答すると、transfersモードでは模範解答（中央線直通・乗換0）と同じ乗換数でパーフェクト判定になる', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: tokyoYamanote, to: shinjukuYamanote }];
      const validation = validateRoute(network, tokyoYamanote, shinjukuYamanote, legs);
      expect(validation.valid).toBe(true);

      const evaluation = evaluateRoute(network, legs, 'transfers');
      const reference = searchRoute(network, tokyoYamanote, shinjukuYamanote, 'transfers')!;
      expect(judgeAnswer('transfers', evaluation, reference).level).toBe('perfect');
    });

    it('山手線で回答すると、timeモードでは中央線(840秒)より遅く miss になる', () => {
      const legs: RouteLeg[] = [{ line: yamanote, from: tokyoYamanote, to: shinjukuYamanote }];
      const evaluation = evaluateRoute(network, legs, 'time');
      const reference = searchRoute(network, tokyoYamanote, shinjukuYamanote, 'time')!;
      expect(reference.totalSec).toBe(840);
      expect(evaluation.totalSec).toBe(1500);

      const judgement = judgeAnswer('time', evaluation, reference);
      expect(judgement.level).toBe('miss');
      expect(judgement.message).toContain('不正解');
    });
  });
});
