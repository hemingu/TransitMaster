import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_QUESTION_COUNT,
  type ChallengeState,
  buildShareIntentUrl,
  buildShareText,
  challengeReducer,
  challengeTitle,
  countCorrect,
  difficultyShortLabel,
  isChallengeFinished,
} from '../src/lib/challenge.ts';
import type { Itinerary } from '../src/lib/types.ts';

const ref = (transfers: number): Itinerary =>
  ({ legs: [], transfers, totalSec: 600 }) as unknown as Itinerary;
const base = { origin: 0, destination: 1, legs: [], skipped: false };

describe('challengeTitle', () => {
  it('正解数ごとの称号', () => {
    expect(challengeTitle(10)).toBe('人間路線検索エンジン');
    expect(challengeTitle(9)).toBe('路線図の住人');
    expect(challengeTitle(8)).toBe('路線図の住人');
    expect(challengeTitle(7)).toBe('乗換上手');
    expect(challengeTitle(5)).toBe('乗換上手');
    expect(challengeTitle(4)).toBe('迷子の旅人');
    expect(challengeTitle(0)).toBe('迷子の旅人');
  });
});

describe('シェア', () => {
  it('難易度の短いラベル', () => {
    expect(difficultyShortLabel('easy')).toBe('かんたん');
    expect(difficultyShortLabel('normal')).toBe('ふつう');
    expect(difficultyShortLabel('hard')).toBe('むずかしい');
  });
  it('投稿本文', () => {
    expect(buildShareText('normal', 8)).toBe(
      '東京23区の乗換、頭の中で何問解ける？\n人力路線検索マスター チャレンジ【ふつう】\n10問中 8問正解🎉 称号：路線図の住人\n\n#人力路線検索マスター'
    );
    expect(buildShareText('hard', 10)).toContain('称号：人間路線検索エンジン');
    expect(buildShareText('easy', 3)).toContain('称号：迷子の旅人');
    expect(buildShareText('easy', 5)).toContain('称号：乗換上手');
  });
  it('インテントURL', () => {
    const url = buildShareIntentUrl('a b\n#x');
    expect(url).toBe(
      'https://x.com/intent/post?text=a%20b%0A%23x&url=https%3A%2F%2Fhemingu.github.io%2FTransitMaster%2F'
    );
  });
});

describe('challengeReducer', () => {
  const started = challengeReducer(null, { type: 'start', id: 1, difficulty: 'easy' }) as ChallengeState;
  const ev = (transfers: number) => ({ transfers, rideSec: 1, totalSec: 1 });
  const answer = (s: ChallengeState, valid: boolean, transfers = 1) =>
    challengeReducer(s, {
      type: 'answer',
      id: 1,
      record: { ...base, valid, evaluation: valid ? ev(transfers) : null },
    })!;
  const reference = (s: ChallengeState, index: number, itinerary: Itinerary | null) =>
    challengeReducer(s, { type: 'reference', id: 1, index, itinerary })!;

  it('無効経路は即 invalid、有効経路は模範解答が来るまで level null', () => {
    let s = answer(started, false);
    expect(s.records[0].level).toBe('invalid');
    s = answer(s, true);
    expect(s.records[1].level).toBeNull();
    expect(isChallengeFinished(s)).toBe(false);
  });

  it('スキップは不正解（invalid）として記録され、模範解答が来ても正解にならない', () => {
    let s = challengeReducer(started, {
      type: 'answer',
      id: 1,
      record: { ...base, valid: false, skipped: true, evaluation: null },
    })!;
    expect(s.records[0].skipped).toBe(true);
    expect(s.records[0].level).toBe('invalid');
    s = reference(s, 0, ref(1));
    expect(s.records[0].referenceReady).toBe(true);
    expect(s.records[0].reference).not.toBeNull();
    expect(s.records[0].level).toBe('invalid');
    expect(countCorrect(s.records)).toBe(0);
  });

  it('模範解答の到着で判定（perfect のみ正解）', () => {
    let s = started;
    for (const t of [1, 2, 3]) {
      s = answer(s, true, t);
      s = reference(s, t - 1, ref(1));
    }
    expect(s.records.map((r) => r.level)).toEqual(['perfect', 'close', 'miss']);
    expect(countCorrect(s.records)).toBe(1);
  });

  it('古いチャレンジIDの結果は無視し、10問超は受け付けない', () => {
    expect(challengeReducer(started, { type: 'reference', id: 0, index: 0, itinerary: null })).toBe(
      started
    );
    let s = started;
    for (let i = 0; i < CHALLENGE_QUESTION_COUNT + 2; i++) s = answer(s, false);
    expect(s.records).toHaveLength(CHALLENGE_QUESTION_COUNT);
    for (let i = 0; i < CHALLENGE_QUESTION_COUNT; i++) s = reference(s, i, null);
    expect(isChallengeFinished(s)).toBe(true);
    expect(countCorrect(s.records)).toBe(0);
  });
});
