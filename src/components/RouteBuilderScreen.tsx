import { useMemo, useState } from 'react';
import { buildLeg, formatLineName, stationDisplayName } from '../lib/game.ts';
import { getNetworkIndex } from '../lib/networkIndex.ts';
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

  // 路線候補は全路線。プレイヤーが路線名を自力で思い出して入力するゲーム性のため、
  // 現在駅を通らない路線もあえて候補に含める（間違いは回答時に判定される）。
  const lineOptions = useMemo<AutocompleteOption[]>(
    () =>
      network.lines.map((line, lineIdx) => {
        const label = formatLineName(network, lineIdx);
        return {
          id: lineIdx,
          label,
          searchText: label,
          badge: { name: line.name, company: line.company, color: line.color },
        };
      }),
    [network]
  );

  // 降車駅候補は全駅（グループ＝物理駅単位で重複排除）。選択路線に依存しない静的リスト。
  // 同名別駅（例: 大阪と東京の京橋）を区別できるよう、乗り入れ路線の要約を note に添える。
  const stationOptions = useMemo<AutocompleteOption[]>(() => {
    const { lineGroups } = getNetworkIndex(network);

    // グループ -> { 最初に見つかった路線, 乗り入れ路線数 }
    const groupLineInfo = new Map<number, { firstLine: number; lineCount: number }>();
    lineGroups.forEach((groups, lineIdx) => {
      for (const group of groups) {
        const info = groupLineInfo.get(group);
        if (info) {
          info.lineCount++;
        } else {
          groupLineInfo.set(group, { firstLine: lineIdx, lineCount: 1 });
        }
      }
    });

    const seenGroups = new Set<number>();
    const options: AutocompleteOption[] = [];
    network.stations.forEach((station, stationIdx) => {
      if (seenGroups.has(station.group)) return;
      seenGroups.add(station.group);
      const info = groupLineInfo.get(station.group);
      const note = info
        ? `${formatLineName(network, info.firstLine)}${info.lineCount >= 2 ? 'ほか' : ''}`
        : undefined;
      options.push({
        id: stationIdx,
        label: station.name,
        searchText: station.name,
        note,
      });
    });
    return options;
  }, [network]);

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
          <h2>乗る路線を入力する</h2>
          <AutocompleteInput
            options={lineOptions}
            placeholder="路線名を入力（例: 銀座線）"
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
            placeholder="駅名を入力"
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
