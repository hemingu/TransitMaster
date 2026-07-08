import { useMemo, useState } from 'react';
import {
  buildLeg,
  filterStationsByQuery,
  formatClock,
  linesThroughStation,
  stationDisplayName,
  stationsOnLine,
} from '../lib/game.ts';
import type { Network, RouteLeg } from '../lib/types.ts';
import { LineBadge } from './LineBadge.tsx';

interface RouteBuilderScreenProps {
  network: Network;
  origin: number;
  destination: number;
  departSec: number;
  streak: number;
  totalCorrect: number;
  totalAnswered: number;
  legs: RouteLeg[];
  currentStation: number;
  onAddLeg: (leg: RouteLeg) => void;
  onUndo: () => void;
  onReset: () => void;
  onSubmit: () => void;
}

export function RouteBuilderScreen({
  network,
  origin,
  destination,
  departSec,
  streak,
  totalCorrect,
  totalAnswered,
  legs,
  currentStation,
  onAddLeg,
  onUndo,
  onReset,
  onSubmit,
}: RouteBuilderScreenProps) {
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const currentGroup = network.stations[currentStation].group;
  const destinationGroup = network.stations[destination].group;
  const reachedDestination = currentGroup === destinationGroup;

  const availableLines = useMemo(
    () => linesThroughStation(network, currentStation),
    [network, currentStation]
  );

  const alightingCandidates = useMemo(() => {
    if (selectedLine === null) return [];
    const stations = stationsOnLine(network, selectedLine, currentGroup);
    return filterStationsByQuery(stations, query);
  }, [network, selectedLine, currentGroup, query]);

  function handleSelectLine(lineIdx: number) {
    setSelectedLine(lineIdx);
    setQuery('');
  }

  function handleAlight(stationIdx: number) {
    if (selectedLine === null) return;
    // 現在駅が別フィードの駅 index の場合があるため、選択路線上の駅 index にマップして leg を作る
    const leg = buildLeg(network, selectedLine, currentStation, stationIdx);
    if (!leg) return;
    onAddLeg(leg);
    setSelectedLine(null);
    setQuery('');
  }

  function handleUndo() {
    setSelectedLine(null);
    setQuery('');
    onUndo();
  }

  function handleReset() {
    setSelectedLine(null);
    setQuery('');
    onReset();
  }

  return (
    <div className="screen builder-screen">
      <div className="score-bar">
        <span>連続正解: {streak}</span>
        <span>
          通算: {totalCorrect} / {totalAnswered}
        </span>
      </div>

      <div className="question-banner">
        <p>
          <strong>{stationDisplayName(network, origin)}</strong> 駅から{' '}
          <strong>{stationDisplayName(network, destination)}</strong> 駅まで
          （平日 {formatClock(departSec)} 発）
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
                <LineBadge name={network.lines[leg.line].name} />
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
          <h2>乗る路線を選ぶ</h2>
          {availableLines.length === 0 ? (
            <p className="muted">この駅から乗れる路線がありません。</p>
          ) : (
            <div className="choice-grid">
              {availableLines.map((lineIdx) => (
                <button
                  key={lineIdx}
                  type="button"
                  className="choice-button line-choice"
                  onClick={() => handleSelectLine(lineIdx)}
                >
                  <LineBadge name={network.lines[lineIdx].name} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="station-picker">
          <h2>
            <LineBadge name={network.lines[selectedLine].name} />
            で降りる駅を選ぶ
          </h2>
          <input
            type="text"
            className="station-search"
            placeholder="駅名で絞り込み"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="station-list">
            {alightingCandidates.length === 0 ? (
              <p className="muted">該当する駅がありません。</p>
            ) : (
              alightingCandidates.map((s) => (
                <button
                  key={s.stationIdx}
                  type="button"
                  className="station-list-item"
                  onClick={() => handleAlight(s.stationIdx)}
                >
                  {s.name}
                </button>
              ))
            )}
          </div>
          <button type="button" className="link-button" onClick={() => setSelectedLine(null)}>
            路線選択に戻る
          </button>
        </div>
      )}

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
