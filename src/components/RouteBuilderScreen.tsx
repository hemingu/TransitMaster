import { useMemo, useState } from 'react';
import {
  buildLeg,
  buildLineOptions,
  buildStationOptions,
  markThroughStationOptions,
  stationDisplayName,
} from '../lib/game.ts';
import { playerGroupOf } from '../lib/networkIndex.ts';
import type { Network, RouteLeg } from '../lib/types.ts';
import { AutocompleteInput } from './AutocompleteInput.tsx';
import { LineBadge } from './LineBadge.tsx';

interface RouteBuilderScreenProps {
  network: Network;
  origin: number;
  destination: number;
  streak: number;
  totalCorrect: number;
  totalAnswered: number;
  legs: RouteLeg[];
  currentStation: number;
  onAddLeg: (leg: RouteLeg) => void;
  onUndo: () => void;
  onReset: () => void;
  onSubmit: () => void;
  onSkip: () => void;
  onBackToTop: () => void;
  /** チャレンジモード時の進捗。指定すると連続正解・通算の代わりに進捗バーを表示する（正誤は明かさない）。 */
  challengeProgress?: { current: number; total: number };
}

export function RouteBuilderScreen({
  network,
  origin,
  destination,
  streak,
  totalCorrect,
  totalAnswered,
  legs,
  currentStation,
  onAddLeg,
  onUndo,
  onReset,
  onSubmit,
  onSkip,
  onBackToTop,
  challengeProgress,
}: RouteBuilderScreenProps) {
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

  // 到着駅と同じ乗換グループ（「使ってもいい」乗換駅を含む）の駅に着けば到着（別名の駅でもよい）
  const reachedDestination = useMemo(
    () => playerGroupOf(network, destination) === playerGroupOf(network, currentStation),
    [network, destination, currentStation]
  );

  // 路線候補は全路線。プレイヤーが路線名を自力で思い出して入力するゲーム性のため、
  // 現在駅を通らない路線もあえて候補に含める（間違いは回答時に判定される）。
  const lineOptions = useMemo(() => buildLineOptions(network), [network]);

  // 降車駅候補は全駅（グループ＝物理駅単位で重複排除）。選択路線に依存しない静的リスト。
  // 同名別駅（例: 別の場所にある同名の浅草）は乗り入れ路線名の note で区別する（一意な駅名は note なし）。
  const baseStationOptions = useMemo(() => buildStationOptions(network), [network]);
  // 選んだ路線に現在駅で乗ってそのまま直通先で着ける駅には「〇〇線直通」の印を付ける
  const stationOptions = useMemo(
    () =>
      selectedLine === null
        ? baseStationOptions
        : markThroughStationOptions(network, baseStationOptions, selectedLine, currentStation),
    [network, baseStationOptions, selectedLine, currentStation]
  );

  function handleSelectLine(lineIdx: number) {
    setSelectedLine(lineIdx);
  }

  function handleAlight(stationIdx: number) {
    if (selectedLine === null) return;
    // 選択路線上の駅 index にマップして leg を作る。路線上にない駅ならそのままの index が
    // 使われ、回答時に validateRoute が不正解として弾く（入力時点では正誤を明かさない）。
    const leg = buildLeg(network, selectedLine, currentStation, stationIdx);
    onAddLeg(leg);
    setSelectedLine(null);
  }

  function handleUndo() {
    setSelectedLine(null);
    onUndo();
  }

  function handleReset() {
    setSelectedLine(null);
    onReset();
  }

  return (
    <div className="screen builder-screen">
      <div className="score-bar">
        {challengeProgress ? (
          <div className="challenge-progress">
            <div
              className="challenge-progress-bar"
              role="progressbar"
              aria-label="チャレンジの進捗"
              aria-valuemin={0}
              aria-valuenow={challengeProgress.current}
              aria-valuemax={challengeProgress.total}
              aria-valuetext={`${challengeProgress.total}問中${challengeProgress.current}問目`}
            >
              {Array.from({ length: challengeProgress.total }, (_, i) => (
                <span
                  key={i}
                  className={`challenge-progress-seg${
                    i + 1 < challengeProgress.current
                      ? ' done'
                      : i + 1 === challengeProgress.current
                        ? ' current'
                        : ''
                  }`}
                />
              ))}
            </div>
            <span className="challenge-progress-label">
              {challengeProgress.current}/{challengeProgress.total}
            </span>
          </div>
        ) : (
          <>
            <span>連続正解: {streak}</span>
            <span>
              通算: {totalCorrect} / {totalAnswered}
            </span>
          </>
        )}
      </div>

      <div className="builder-header">
        <button type="button" className="link-button" onClick={onSkip}>
          回答スキップ
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            if (window.confirm('プレイ中の問題は破棄されます。トップ画面に戻りますか？')) {
              onBackToTop();
            }
          }}
        >
          トップに戻る
        </button>
      </div>

      <div className="question-banner">
        <p>
          <strong>{stationDisplayName(network, origin)}</strong> 駅から{' '}
          <strong>{stationDisplayName(network, destination)}</strong> 駅まで
        </p>
      </div>

      <div className="route-progress">
        <h2>組み立て中の経路</h2>
        <p className="route-summary">
          {legs.length === 0 ? (
            <span className="muted">（まだ経路がありません）</span>
          ) : (
            legs.map((leg, i) => (
              <span className="route-leg-chip" key={i}>
                <LineBadge
                  name={network.lines[leg.line].name}
                  company={network.lines[leg.line].company}
                  color={network.lines[leg.line].color}
                />
                <span>
                  {stationDisplayName(network, leg.from)}→{stationDisplayName(network, leg.to)}
                </span>
              </span>
            ))
          )}
        </p>
        <p className="current-station">
          現在駅: <strong>{stationDisplayName(network, currentStation)}</strong>
          {reachedDestination && <span className="reached-badge">到着駅に到達</span>}
        </p>
        <div className="button-row">
          <button type="button" onClick={handleUndo} disabled={legs.length === 0}>
            1つ戻す
          </button>
          <button type="button" onClick={handleReset} disabled={legs.length === 0}>
            最初から
          </button>
        </div>
      </div>

      {selectedLine === null ? (
        <div className="line-picker">
          <h2>乗る路線を入力する</h2>
          <AutocompleteInput
            options={lineOptions}
            placeholder="路線名を入力（例: 銀座線 / ぎんざせん / ginza）"
            onSelect={handleSelectLine}
            emptyMessage="該当する路線がありません。"
          />
        </div>
      ) : (
        <div className="station-picker">
          <h2>
            <LineBadge
              name={network.lines[selectedLine].name}
              company={network.lines[selectedLine].company}
              color={network.lines[selectedLine].color}
            />
            で降りる駅を入力する
          </h2>
          <AutocompleteInput
            options={stationOptions}
            placeholder="駅名を入力（漢字・かな・ローマ字）"
            onSelect={handleAlight}
            emptyMessage="該当する駅がありません。"
            autoFocus
          />
          <button type="button" className="link-button" onClick={() => setSelectedLine(null)}>
            路線選択に戻る
          </button>
        </div>
      )}

      <details className="through-help">
        <summary>直通運転の入力方法</summary>
        <div className="through-help-body">
          <p>
            直通運転の列車にそのまま乗り続ける場合は、次のどちらの入力でもOKです。どちらも乗換回数には数えません。
          </p>
          <p className="through-help-example">
            例：永田町 → 三軒茶屋（半蔵門線から東急田園都市線へ直通）
          </p>
          <ul className="through-help-list">
            <li>
              <span className="through-help-tag">まとめて入力</span>
              路線「半蔵門線」を選び、降車駅で「田園都市線直通」と添えられた「三軒茶屋」を選ぶ
            </li>
            <li>
              <span className="through-help-tag">分けて入力</span>
              「半蔵門線」で永田町 → 渋谷、続けて「田園都市線」で渋谷 → 三軒茶屋
            </li>
          </ul>
          <p className="muted">
            ※ 降車駅の候補に「〇〇線直通」と書かれた駅は、選んだ路線の列車がそのまま乗り入れる駅です。
          </p>
        </div>
      </details>

      <button
        type="button"
        className="primary-button submit-button"
        disabled={legs.length === 0}
        onClick={onSubmit}
      >
        回答する
      </button>
    </div>
  );
}
