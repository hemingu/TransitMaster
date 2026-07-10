import { useMemo, useState } from 'react';
import {
  buildLeg,
  formatLineName,
  linesThroughStation,
  stationDisplayName,
  stationsOnLine,
} from '../lib/game.ts';
import type { AutocompleteOption } from '../lib/autocomplete.ts';
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
}: RouteBuilderScreenProps) {
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

  const currentGroup = network.stations[currentStation].group;
  const destinationGroup = network.stations[destination].group;
  const reachedDestination = currentGroup === destinationGroup;

  const lineOptions = useMemo<AutocompleteOption[]>(() => {
    const lineIdxs = linesThroughStation(network, currentStation);
    return lineIdxs.map((lineIdx) => {
      const line = network.lines[lineIdx];
      const label = formatLineName(network, lineIdx);
      return {
        id: lineIdx,
        label,
        searchText: label,
        badge: { name: line.name, company: line.company, color: line.color },
      };
    });
  }, [network, currentStation]);

  const stationOptions = useMemo<AutocompleteOption[]>(() => {
    if (selectedLine === null) return [];
    const stations = stationsOnLine(network, selectedLine, currentGroup);
    return stations.map((s) => ({
      id: s.stationIdx,
      label: s.name,
      searchText: s.name,
    }));
  }, [network, selectedLine, currentGroup]);

  function handleSelectLine(lineIdx: number) {
    setSelectedLine(lineIdx);
  }

  function handleAlight(stationIdx: number) {
    if (selectedLine === null) return;
    // 現在駅が別フィードの駅 index の場合があるため、選択路線上の駅 index にマップして leg を作る
    const leg = buildLeg(network, selectedLine, currentStation, stationIdx);
    if (!leg) return;
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
        <span>連続正解: {streak}</span>
        <span>
          通算: {totalCorrect} / {totalAnswered}
        </span>
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
          <h2>乗る路線を選ぶ</h2>
          {lineOptions.length === 0 ? (
            <p className="muted">この駅から乗れる路線がありません。</p>
          ) : (
            <AutocompleteInput
              options={lineOptions}
              placeholder="路線名で検索（例: 銀座線）"
              onSelect={handleSelectLine}
              emptyMessage="該当する路線がありません。"
            />
          )}
        </div>
      ) : (
        <div className="station-picker">
          <h2>
            <LineBadge
              name={network.lines[selectedLine].name}
              company={network.lines[selectedLine].company}
              color={network.lines[selectedLine].color}
            />
            で降りる駅を選ぶ
          </h2>
          <AutocompleteInput
            options={stationOptions}
            placeholder="駅名で検索"
            onSelect={handleAlight}
            emptyMessage="該当する駅がありません。"
            autoFocus
          />
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
