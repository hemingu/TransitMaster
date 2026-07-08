import {
  formatDuration,
  formatFare,
  formatRouteLegs,
  reasonMessage,
} from '../lib/game.ts';
import type { RouteEvaluation } from '../lib/validate.ts';
import type { AnswerMode, Itinerary, Network, RouteLeg } from '../lib/types.ts';
import type { Judgement } from '../lib/game.ts';

interface ResultScreenProps {
  network: Network;
  mode: AnswerMode;
  departSec: number;
  legs: RouteLeg[];
  streak: number;
  totalCorrect: number;
  totalAnswered: number;
  valid: boolean;
  invalidReason?: string;
  invalidLegIndex?: number;
  evaluation: RouteEvaluation | null;
  reference: Itinerary | null;
  judgement: Judgement | null;
  referenceLoading: boolean;
  onNext: () => void;
}

const MODE_LABELS: Record<AnswerMode, string> = {
  time: '最短時間',
  transfers: '最小乗換',
  fare: '最安運賃',
};

export function ResultScreen({
  network,
  mode,
  departSec,
  legs,
  streak,
  totalCorrect,
  totalAnswered,
  valid,
  invalidReason,
  invalidLegIndex,
  evaluation,
  reference,
  judgement,
  referenceLoading,
  onNext,
}: ResultScreenProps) {
  return (
    <div className="screen result-screen">
      <div className="score-bar">
        <span>連続正解: {streak}</span>
        <span>
          通算: {totalCorrect} / {totalAnswered}
        </span>
      </div>

      {!valid ? (
        <div className="result-card incorrect">
          <h1>不正解</h1>
          <p className="result-reason">
            {reasonMessage(network, legs, invalidReason, invalidLegIndex)}
          </p>
          <p className="answer-route">あなたの経路: {formatRouteLegs(network, legs)}</p>
        </div>
      ) : (
        <div
          className={`result-card correct${judgement?.level === 'perfect' ? ' perfect' : ''}`}
        >
          <h1>{judgement?.level === 'perfect' ? 'パーフェクト！' : '正解！'}</h1>
          {judgement && <p className="judgement-message">{judgement.message}</p>}

          <div className="comparison">
            <div className="comparison-col">
              <h2>あなたの経路（{MODE_LABELS[mode]}モードで判定）</h2>
              <p className="answer-route">{formatRouteLegs(network, legs)}</p>
              {evaluation && (
                <ul className="stat-list">
                  <li>乗換回数: {evaluation.transfers}回</li>
                  <li>
                    所要時間:{' '}
                    {evaluation.durationSec !== null
                      ? `${formatDuration(evaluation.durationSec)}（待ち時間含む）`
                      : '不明'}
                  </li>
                  <li>運賃: {formatFare(evaluation.fare)}</li>
                </ul>
              )}
            </div>

            <div className="comparison-col">
              <h2>模範解答</h2>
              {referenceLoading && <p className="muted">計算中...</p>}
              {!referenceLoading && reference === null && (
                <p className="muted">模範解答が見つかりませんでした。</p>
              )}
              {!referenceLoading && reference !== null && (
                <>
                  <p className="answer-route">{formatRouteLegs(network, reference.legs)}</p>
                  <ul className="stat-list">
                    <li>乗換回数: {reference.transfers}回</li>
                    {/* 判定と同じ基準（出題の出発時刻起点＝初回の列車待ち込み）で表示する */}
                    <li>所要時間: {formatDuration(reference.arrive - departSec)}（待ち時間含む）</li>
                    <li>運賃: {formatFare(reference.fare)}</li>
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <button type="button" className="primary-button next-button" onClick={onNext}>
        次の問題へ
      </button>
    </div>
  );
}
