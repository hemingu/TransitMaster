import type { AnswerMode, Itinerary, Network, RouteEvaluation, RouteLeg } from './types.ts';
import { getNetworkIndex } from './networkIndex.ts';
import { kataToHira, type AutocompleteOption } from './autocomplete.ts';
import { prefName } from './prefNames.ts';

/** difficulty -> generateQuestion の乗換回数レンジ */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'かんたん（乗換1回）',
  normal: 'ふつう（乗換1〜2回）',
  hard: 'むずかしい（乗換2回以上）',
};

export function difficultyToTransferRange(difficulty: Difficulty): {
  minTransfers: number;
  maxTransfers?: number;
} {
  switch (difficulty) {
    case 'easy':
      return { minTransfers: 1, maxTransfers: 1 };
    case 'normal':
      return { minTransfers: 1, maxTransfers: 2 };
    case 'hard':
      return { minTransfers: 2 };
  }
}

/** 秒数を "X分" もしくは "X時間Y分" 形式に整形する */
export function formatDuration(sec: number): string {
  const totalMinutes = Math.round(sec / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) {
    return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  }
  return `${m}分`;
}

/**
 * 駅間所要秒(segSec)ベースの推定所要時間を "約X分（推定）" もしくは
 * "約X時間Y分（推定）" 形式に整形する。時刻表を廃止したため、実際の発着時刻ではなく
 * あくまで区間所要秒の合計に基づく目安であることを明示する。
 */
export function formatEstimatedDuration(sec: number): string {
  return `約${formatDuration(sec)}（推定）`;
}

/** 駅のグループ代表名（グループ内先頭に見つかった駅の name）を返す */
export function stationDisplayName(network: Network, stationIdx: number): string {
  const station = network.stations[stationIdx];
  if (!station) return '(不明な駅)';
  return station.name;
}

/** グループ番号から、そのグループに属する駅の代表名を返す（グループ内最初の駅のname） */
export function groupDisplayName(network: Network, group: number): string {
  const station = network.stations.find((s) => s.group === group);
  return station ? station.name : '(不明な駅)';
}

/** 路線名を "路線名（事業者名）" の形式に整形する（例: 銀座線（東京メトロ）） */
export function formatLineName(network: Network, lineIdx: number): string {
  const line = network.lines[lineIdx];
  if (!line) return '不明な路線';
  return `${line.name}（${line.company}）`;
}

/**
 * 路線オートコンプリートの候補一覧（全路線）を構築する。
 * label は「路線名（事業者名）」、searchText はふりがな（カナ）があればカタカナ・ひらがな両方を連結して
 * カナ入力でもヒットするようにする。badge は LineBadge 表示用。
 */
export function buildLineOptions(network: Network): AutocompleteOption[] {
  return network.lines.map((line, lineIdx) => {
    const label = formatLineName(network, lineIdx);
    const searchText = line.kana ? `${label} ${line.kana} ${kataToHira(line.kana)}` : label;
    return {
      id: lineIdx,
      label,
      searchText,
      badge: { name: line.name, company: line.company, color: line.color },
    };
  });
}

/**
 * 降車駅オートコンプリートの候補一覧（全駅をグループ＝物理駅単位で重複排除）を構築する。
 * - id はグループ代表（stations 配列で最初に出現する駅index）
 * - searchText はふりがな（カナ）があればカタカナ・ひらがな両方を連結
 * - 同じ駅名が複数グループに存在する場合（例: 大阪と東京の京橋）に限り、
 *   note に都道府県名を添えて区別できるようにする（pref=0 等で判定不能なら表示しない）
 */
export function buildStationOptions(network: Network): AutocompleteOption[] {
  const seenGroups = new Set<number>();
  const representatives: { stationIdx: number; name: string; kana?: string; pref: number }[] = [];
  const groupCountByName = new Map<string, number>();

  network.stations.forEach((station, stationIdx) => {
    if (seenGroups.has(station.group)) return;
    seenGroups.add(station.group);
    representatives.push({
      stationIdx,
      name: station.name,
      kana: station.kana,
      pref: station.pref,
    });
    groupCountByName.set(station.name, (groupCountByName.get(station.name) ?? 0) + 1);
  });

  return representatives.map((rep) => {
    const searchText = rep.kana ? `${rep.name} ${rep.kana} ${kataToHira(rep.kana)}` : rep.name;
    const option: AutocompleteOption = { id: rep.stationIdx, label: rep.name, searchText };
    if ((groupCountByName.get(rep.name) ?? 0) >= 2) {
      const pref = prefName(rep.pref);
      if (pref !== null) {
        option.note = pref;
      }
    }
    return option;
  });
}

/** 指定駅（グループ）を通る路線のインデックス一覧を重複なく返す */
export function linesThroughStation(network: Network, stationIdx: number): number[] {
  const group = network.stations[stationIdx]?.group;
  if (group === undefined) return [];
  const index = getNetworkIndex(network);
  const result: number[] = [];
  index.lineGroups.forEach((groups, lineIdx) => {
    if (groups.has(group)) {
      result.push(lineIdx);
    }
  });
  return result;
}

/**
 * 指定路線に含まれる駅（グループ代表で重複排除）の一覧を、
 * excludeGroup（現在駅のグループ）を除いて返す。
 * 戻り値は { stationIdx, name } のリストで、stationIdx は路線上で最初に見つかった駅のindex。
 */
export function stationsOnLine(
  network: Network,
  lineIdx: number,
  excludeGroup?: number
): { stationIdx: number; name: string; group: number }[] {
  const line = network.lines[lineIdx];
  if (!line) return [];

  const seenGroups = new Set<number>();
  const result: { stationIdx: number; name: string; group: number }[] = [];

  for (const pattern of line.patterns) {
    for (const stopIdx of pattern.stops) {
      const group = network.stations[stopIdx].group;
      if (excludeGroup !== undefined && group === excludeGroup) continue;
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
      result.push({ stationIdx: stopIdx, name: network.stations[stopIdx].name, group });
    }
  }

  return result;
}

/**
 * 指定駅と同一グループの駅のうち、指定路線の Pattern.stops に実際に含まれる
 * 駅 index を返す。見つからなければ null。
 *
 * Station は路線ごとに別レコードのため（例: 東京(山手線) と 東京(丸ノ内線) は
 * 同一グループだが別 index）、直前の路線で降りた駅 index をそのまま次の路線の
 * leg.from に使うと validateRoute が 'station-not-on-line' で落ちる。
 * leg 生成時にこのヘルパーで路線上の駅 index へマップして吸収する。
 */
export function stationOnLineInGroup(
  network: Network,
  lineIdx: number,
  stationIdx: number
): number | null {
  const line = network.lines[lineIdx];
  const station = network.stations[stationIdx];
  if (!line || !station) return null;

  const group = station.group;
  const index = getNetworkIndex(network);
  const members = index.groupMembers.get(group) ?? [stationIdx];
  const memberSet = new Set(members);

  for (const pattern of line.patterns) {
    for (const stopIdx of pattern.stops) {
      if (memberSet.has(stopIdx)) {
        return stopIdx;
      }
    }
  }
  return null;
}

/**
 * 経路組立UIの leg 生成用ヘルパー。
 * from（現在駅）・to（降車駅）をそれぞれ選択路線上の駅 index にマップした
 * RouteLeg を返す。
 *
 * 路線・降車駅は全候補から自由入力で選べるため、選択路線上に存在しない駅が渡されうる。
 * その場合はマッピングを諦めて元の駅 index をそのまま使う。即時エラーにはせず、
 * 回答時に validateRoute が 'station-not-on-line' 等の理由付きで不正解と判定する
 * （プレイヤーが路線名・駅名を自力で思い出すゲーム性のため、入力時点では正誤を明かさない）。
 */
export function buildLeg(
  network: Network,
  lineIdx: number,
  fromStation: number,
  toStation: number
): RouteLeg {
  const from = stationOnLineInGroup(network, lineIdx, fromStation) ?? fromStation;
  const to = stationOnLineInGroup(network, lineIdx, toStation) ?? toStation;
  return { line: lineIdx, from, to };
}

/** インクリメンタル絞り込み: クエリ文字列を含む駅名のみを残す（大小文字区別なし、簡易） */
export function filterStationsByQuery<T extends { name: string }>(
  stations: T[],
  query: string
): T[] {
  const q = query.trim();
  if (q === '') return stations;
  return stations.filter((s) => s.name.includes(q));
}

/** 日本語の判定理由メッセージを生成する */
export function reasonMessage(
  network: Network,
  legs: RouteLeg[],
  reason: string | undefined,
  legIndex: number | undefined
): string {
  if (reason === undefined) return '';
  const leg = legIndex !== undefined ? legs[legIndex] : undefined;
  const lineName = leg ? formatLineName(network, leg.line) : '不明な路線';
  const fromName = leg ? stationDisplayName(network, leg.from) : '';
  const toName = leg ? stationDisplayName(network, leg.to) : '';

  switch (reason) {
    case 'empty':
      return '経路が組み立てられていません。乗車区間を追加してください。';
    case 'wrong-origin':
      return `最初の乗車駅「${fromName}」が出発駅と異なります。`;
    case 'wrong-destination':
      return `最後の降車駅「${toName}」が到着駅と異なります。`;
    case 'station-not-on-line':
      return `「${fromName}」または「${toName}」は${lineName}の駅ではありません。`;
    case 'not-connected-on-line':
      return `${lineName}では「${fromName}」から「${toName}」へ移動できません。`;
    case 'bad-transfer':
      return `乗換区間${legIndex !== undefined ? legIndex + 1 : ''}で乗換元と乗車駅が一致していません。`;
    case 'degenerate-leg':
      return `乗車区間${legIndex !== undefined ? legIndex + 1 : ''}の乗車駅と降車駅が同じです。`;
    default:
      return '経路が不正です。';
  }
}

export type JudgementLevel = 'perfect' | 'close' | 'miss' | 'invalid';

export interface Judgement {
  level: JudgementLevel;
  message: string;
}

/**
 * ユーザーの解答評価（evaluateRoute の結果）と模範解答（Itinerary、無ければ null）を
 * 選択中の AnswerMode の指標で比較し、3段階（perfect / close / miss）で判定する。
 * 「正解」はパーフェクト（模範解答と同等以下）のみ。それ以外は超過の度合いに応じて
 * 「おしい！」（close）か「不正解…」（miss）になる。
 *
 * - mode='time'（ratio = evaluation.totalSec / reference.totalSec）:
 *   ratio <= 1.0 -> perfect、ratio <= 1.1 -> close、ratio > 1.1 -> miss。
 *   totalSec が算出不能（null）なら miss。
 * - mode='transfers'（diff = evaluation.transfers - reference.transfers）:
 *   diff <= 0 -> perfect、diff === 1 -> close、diff >= 2 -> miss。
 *
 * 模範解答が見つからない（reference === null）場合は比較のしようがないため perfect 扱い。
 * 経路自体が無効な場合（invalid）はこの関数を通らず reasonMessage で理由を表示する。
 */
export function judgeAnswer(
  mode: AnswerMode,
  evaluation: RouteEvaluation,
  reference: Itinerary | null
): Judgement {
  if (reference === null) {
    // 模範解答が無い（探索不能）場合は比較のしようがないため正解扱いとする
    return { level: 'perfect', message: '模範解答が見つからなかったため正解扱いです' };
  }

  if (mode === 'transfers') {
    const refTransfers = reference.transfers;
    const diff = evaluation.transfers - refTransfers;
    if (diff <= 0) {
      return {
        level: 'perfect',
        message: `パーフェクト！最少の乗換回数です（乗換${refTransfers}回）`,
      };
    }
    if (diff === 1) {
      return {
        level: 'close',
        message: `おしい！模範解答より乗換1回多い経路です（模範解答: 乗換${refTransfers}回）`,
      };
    }
    return { level: 'miss', message: `不正解… 模範解答は乗換${refTransfers}回でした` };
  }

  // mode === 'time'
  const refDuration = formatEstimatedDuration(reference.totalSec);
  if (evaluation.totalSec === null) {
    return {
      level: 'miss',
      message: `所要時間を算出できませんでした（模範解答: ${refDuration}）`,
    };
  }
  const ratio = evaluation.totalSec / reference.totalSec;
  if (ratio <= 1.0) {
    return {
      level: 'perfect',
      message: `パーフェクト！模範解答と同じ所要時間です（${refDuration}）`,
    };
  }
  // 超過率（%）。四捨五入で0%になる僅かな超過も「おしい」と表現できるよう最低1%とする
  const percent = Math.max(1, Math.round((ratio - 1) * 100));
  if (ratio <= 1.1) {
    return {
      level: 'close',
      message: `おしい！模範解答より約${percent}%長い経路です（模範解答: ${refDuration}）`,
    };
  }
  return {
    level: 'miss',
    message: `不正解… 模範解答より約${percent}%長い経路です（模範解答: ${refDuration}）`,
  };
}

/** 組み立て中の経路を表示用文字列に変換する（例: "山手線（JR東日本） 東京→上野 ｜ 丸ノ内線（東京メトロ） 上野→新宿"） */
export function formatRouteLegs(network: Network, legs: RouteLeg[]): string {
  if (legs.length === 0) return '（まだ経路がありません）';
  return legs
    .map((leg) => {
      const lineName = formatLineName(network, leg.line);
      const fromName = stationDisplayName(network, leg.from);
      const toName = stationDisplayName(network, leg.to);
      return `${lineName} ${fromName}→${toName}`;
    })
    .join(' ｜ ');
}

/** Itinerary（模範解答）を表示用文字列に変換する */
export function formatItinerary(network: Network, itinerary: Itinerary): string {
  return formatRouteLegs(network, itinerary.legs);
}
