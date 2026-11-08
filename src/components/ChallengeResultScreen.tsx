import { useState } from 'react';
import {
  CHALLENGE_DIFFICULTY_LABELS,
  CHALLENGE_QUESTION_COUNT,
  type ChallengeState,
  buildShareIntentUrl,
  buildShareText,
  challengeTitle,
  countCorrect,
  isCorrect,
  isChallengeFinished,
  difficultyShortLabel,
} from '../lib/challenge.ts';
import {
  formatEstimatedDuration,
  formatRouteLegs,
  formatPlayerRouteLegs,
  reasonMessage,
  stationDisplayName,
} from '../lib/game.ts';
import type { Network } from '../lib/types.ts';

interface ChallengeResultScreenProps {
  network: Network;
  challenge: ChallengeState;
  onRetry: () => void;
  onBackToTop: () => void;
}

export function ChallengeResultScreen({
  network,
  challenge,
  onRetry,
  onBackToTop,
}: ChallengeResultScreenProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const finished = isChallengeFinished(challenge);

  // 模範解答の計算が残っている間は集計せず「集計中」を表示する
  if (!finished) {
    return (
      <div className="screen loading-screen">
        <p>結果を集計中...</p>
        <div className="spinner" />
      </div>
    );
  }

  const correct = countCorrect(challenge.records);
  const title = challengeTitle(correct);

  function handleShare() {
    const text = buildShareText(challenge.difficulty, correct);
    window.open(buildShareIntentUrl(text), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="screen challenge-result-screen">
      <div className="result-card correct perfect challenge-summary">
        <p className="challenge-difficulty">
          チャレンジ【{CHALLENGE_DIFFICULTY_LABELS[challenge.difficulty]}】
        </p>
        <h1 className="challenge-score">
          {CHALLENGE_QUESTION_COUNT}問中 {correct}問正解
        </h1>
        <p className="challenge-title">称号：{title}</p>
      </div>

      <ul className="challenge-list">
        {challenge.records.map((r, i) => {
          const open = openIndex === i;
          const ok = isCorrect(r);
          return (
            <li key={i} className={`challenge-row${ok ? ' ok' : ' ng'}`}>
              <button
                type="button"
                className="challenge-row-head"
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                <span className="challenge-row-q">Q{i + 1}</span>
                <span className="challenge-row-route">
                  {stationDisplayName(network, r.origin)} →{' '}
                  {stationDisplayName(network, r.destination)}
                </span>
                <span className="challenge-row-verdict">
                  {ok ? '○正解' : r.skipped ? '−スキップ' : '×不正解'}
                </span>
              </button>
              {open && (
                <div className="challenge-row-body">
                  <div className="comparison-col">
                    <h2>あなたの経路</h2>
                    {r.skipped && <p className="muted">スキップしました</p>}
                    {!r.valid && !r.skipped && (
                      <p className="result-reason">
                        {reasonMessage(
                          network,
                          r.legs,
                          r.invalidReason,
                          r.invalidLegIndex,
                          r
                        )}
                      </p>
                    )}
                    {!r.skipped && (
                      <p className="answer-route">
                        {formatPlayerRouteLegs(network, r.legs)}
                      </p>
                    )}
                    {r.evaluation && (
                      <ul className="stat-list">
                        <li>乗換回数: {r.evaluation.transfers}回</li>
                        <li>
                          所要時間:{' '}
                          {r.evaluation.totalSec !== null
                            ? formatEstimatedDuration(r.evaluation.totalSec)
                            : '不明'}
                        </li>
                      </ul>
                    )}
                  </div>
                  <div className="comparison-col">
                    <h2>模範解答</h2>
                    {r.reference === null ? (
                      <p className="muted">模範解答が見つかりませんでした。</p>
                    ) : (
                      <>
                        <p className="answer-route">
                          {formatRouteLegs(network, r.reference.legs)}
                        </p>
                        <ul className="stat-list">
                          <li>乗換回数: {r.reference.transfers}回</li>
                          <li>
                            所要時間:{' '}
                            {formatEstimatedDuration(r.reference.totalSec)}
                          </li>
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="setup-note">
        {difficultyShortLabel(challenge.difficulty)}
        （東京23区内・最小乗換・主要駅のみ）の結果です。
      </p>

      <div className="challenge-actions">
        <button type="button" className="primary-button" onClick={handleShare}>
          Xでシェア
        </button>
        <button type="button" className="primary-button" onClick={onRetry}>
          もう一度チャレンジ
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onBackToTop}
        >
          トップに戻る
        </button>
      </div>
    </div>
  );
}
