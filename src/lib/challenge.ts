import { type Difficulty, type JudgementLevel, judgeAnswer } from './game.ts';
import { type AreaId, stationsInArea } from './area.ts';
import { filterStationsByTopGroups } from './stationScale.ts';
import type { AnswerMode, Itinerary, Network, RouteEvaluation, RouteLeg } from './types.ts';

/** チャレンジモードの出題数。 */
export const CHALLENGE_QUESTION_COUNT = 10;

/** チャレンジモードの固定条件（エリアは東京23区内、乗換は1〜2回、答え方は最小乗換）。 */
export const CHALLENGE_MODE: AnswerMode = 'transfers';

/** チャレンジモードの出題エリア。 */
export const CHALLENGE_AREA: AreaId = 'tokyo23';

/** チャレンジモードの乗換回数レンジ（難易度によらず固定）。 */
export const CHALLENGE_TRANSFER_RANGE: { minTransfers: number; maxTransfers?: number } = {
  minTransfers: 1,
  maxTransfers: 2,
};

/** 難易度ごとの出題駅プール = 23区内の乗降客数上位N件の乗換グループ（null = 全グループ）。 */
export const CHALLENGE_TOP_GROUPS: Record<Difficulty, number | null> = {
  easy: 50,
  normal: 100,
  hard: null,
};

/** チャレンジの難易度に応じた出題候補の駅（index）。 */
export function challengeStations(network: Network, difficulty: Difficulty): number[] {
  return filterStationsByTopGroups(
    network,
    stationsInArea(network, CHALLENGE_AREA),
    CHALLENGE_TOP_GROUPS[difficulty]
  );
}

/** シェアで案内するサイトURL（本番）。 */
export const SHARE_URL = 'https://hemingu.github.io/TransitMaster/';

const DIFFICULTY_SHORT_LABELS: Record<Difficulty, string> = {
  easy: 'かんたん',
  normal: 'ふつう',
  hard: 'むずかしい',
};

/** 難易度の短い名前（括弧内の説明を除いたもの）。 */
export function difficultyShortLabel(difficulty: Difficulty): string {
  return DIFFICULTY_SHORT_LABELS[difficulty];
}

/** 正解数に応じた称号。 */
export function challengeTitle(correct: number): string {
  if (correct >= 10) return '人間路線検索エンジン';
  if (correct >= 8) return '路線図の住人';
  if (correct >= 5) return '乗換上手';
  return '迷子の旅人';
}

/** Xシェア用の投稿本文（URLは別パラメータで渡す）。 */
export function buildShareText(difficulty: Difficulty, correct: number): string {
  return [
    '東京23区の乗換、頭の中で何問解ける？',
    `人力路線検索マスター チャレンジ【${difficultyShortLabel(difficulty)}】`,
    `${CHALLENGE_QUESTION_COUNT}問中 ${correct}問正解🎉 称号：${challengeTitle(correct)}`,
    '',
    '#人力路線検索マスター',
  ].join('\n');
}

/** X（旧Twitter）の投稿インテントURL。 */
export function buildShareIntentUrl(text: string, url: string = SHARE_URL): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

// ---- 状態管理（純粋なリデューサー） ----

/** 1問ぶんの記録。reference/level は模範解答の計算が終わるまで未確定。 */
export interface ChallengeRecord {
  origin: number;
  destination: number;
  legs: RouteLeg[];
  valid: boolean;
  /** 「回答スキップ」で飛ばした問題か（不正解扱い。valid は false、legs は空）。 */
  skipped: boolean;
  invalidReason?: string;
  invalidLegIndex?: number;
  evaluation: RouteEvaluation | null;
  /** 模範解答の計算が完了したか。 */
  referenceReady: boolean;
  reference: Itinerary | null;
  /** 判定レベル。経路が無効・スキップなら 'invalid'、模範解答の計算待ちなら null。 */
  level: JudgementLevel | null;
}

export interface ChallengeState {
  /** チャレンジの通し番号。再挑戦後に古い非同期結果が混ざるのを防ぐ。 */
  id: number;
  difficulty: Difficulty;
  records: ChallengeRecord[];
}

export type ChallengeAction =
  | { type: 'start'; id: number; difficulty: Difficulty }
  | { type: 'clear' }
  | {
      type: 'answer';
      id: number;
      record: Omit<ChallengeRecord, 'referenceReady' | 'reference' | 'level'>;
    }
  | { type: 'reference'; id: number; index: number; itinerary: Itinerary | null };

export function challengeReducer(
  state: ChallengeState | null,
  action: ChallengeAction
): ChallengeState | null {
  if (action.type === 'clear') return null;
  if (action.type === 'start') {
    return { id: action.id, difficulty: action.difficulty, records: [] };
  }
  if (!state || state.id !== action.id) return state;

  if (action.type === 'answer') {
    if (state.records.length >= CHALLENGE_QUESTION_COUNT) return state;
    const record: ChallengeRecord = {
      ...action.record,
      referenceReady: false,
      reference: null,
      level: action.record.valid ? null : 'invalid',
    };
    return { ...state, records: [...state.records, record] };
  }

  // action.type === 'reference'
  const target = state.records[action.index];
  if (!target || target.referenceReady) return state;
  const level: JudgementLevel =
    target.valid && target.evaluation
      ? judgeAnswer(CHALLENGE_MODE, target.evaluation, action.itinerary).level
      : 'invalid';
  const next = [...state.records];
  next[action.index] = { ...target, referenceReady: true, reference: action.itinerary, level };
  return { ...state, records: next };
}

/** 正解 = パーフェクト判定のみ。 */
export function isCorrect(record: ChallengeRecord): boolean {
  return record.level === 'perfect';
}

export function countCorrect(records: ChallengeRecord[]): number {
  return records.filter(isCorrect).length;
}

/** 10問すべてに回答済みで、かつ全問の模範解答計算が済んでいるか。 */
export function isChallengeFinished(state: ChallengeState): boolean {
  return (
    state.records.length >= CHALLENGE_QUESTION_COUNT &&
    state.records.every((r) => r.referenceReady)
  );
}
