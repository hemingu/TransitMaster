import type { AnswerMode, Itinerary, Network, RouteEvaluation, RouteLeg } from './types.ts';
import { getNetworkIndex } from './networkIndex.ts';

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
 * RouteLeg を返す。どちらかが路線上に存在しなければ null。
 */
export function buildLeg(
  network: Network,
  lineIdx: number,
  fromStation: number,
  toStation: number
): RouteLeg | null {
  const from = stationOnLineInGroup(network, lineIdx, fromStation);
  const to = stationOnLineInGroup(network, lineIdx, toStation);
  if (from === null || to === null) return null;
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

export type JudgementLevel = 'perfect' | 'good' | 'invalid';

export interface Judgement {
  level: JudgementLevel;
  message: string;
}

/**
 * ユーザーの解答評価（evaluateRoute の結果）と模範解答（Itinerary、無ければ null）を
 * 選択中の AnswerMode の指標で比較し、パーフェクト／正解の判定を行う。
 *
 * パーフェクト条件:
 * - mode='transfers': ユーザーの乗換回数 <= 模範解答の乗換回数
 * - mode='time'      : ユーザーの総所要秒 <= 模範解答の総所要秒 * 1.1（±10%以内）
 *   上記を満たさない場合は「正解（模範解答は○○）」の good 判定。
 *
 * 模範解答が見つからない（reference === null）場合は比較のしようがないため good 判定にする。
 */
export function judgeAnswer(
  mode: AnswerMode,
  evaluation: RouteEvaluation,
  reference: Itinerary | null
): Judgement {
  if (reference === null) {
    // 模範解答が無い（探索不能）場合は比較のしようがないため正解扱いとする
    return { level: 'good', message: '正解！（模範解答は見つかりませんでした）' };
  }

  if (mode === 'transfers') {
    const isPerfect = evaluation.transfers <= reference.transfers;
    return isPerfect
      ? { level: 'perfect', message: 'パーフェクト！（模範解答と同じかそれ以下の乗換回数です）' }
      : {
          level: 'good',
          message: `正解！（模範解答は乗換${reference.transfers}回でした）`,
        };
  }

  // mode === 'time'
  if (evaluation.totalSec === null) {
    return {
      level: 'good',
      message: `正解！（模範解答は${formatEstimatedDuration(reference.totalSec)}でした）`,
    };
  }
  const isPerfect = evaluation.totalSec <= reference.totalSec * 1.1;
  return isPerfect
    ? { level: 'perfect', message: 'パーフェクト！（模範解答とほぼ同じ所要時間です）' }
    : {
        level: 'good',
        message: `正解！（模範解答は${formatEstimatedDuration(reference.totalSec)}でした）`,
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
