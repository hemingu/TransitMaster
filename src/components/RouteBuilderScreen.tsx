import { useMemo, useState } from 'react';
import {
  buildLeg,
  buildLineOptions,
  buildStationOptions,
  stationDisplayName,
} from '../lib/game.ts';
import type { Network, RouteLeg } from '../lib/types.ts';
import { AutocompleteInput } from './AutocompleteInput.tsx';
import { LineBadge } from './LineBadge.tsx';

interface RouteBuilderScreenProps {
  network: Network;
  origin: number;
  destination: number;
  /** true のとき新幹線（lineType===1）を路線・駅候補から除外する（「日本全国」以外のエリア）。 */
  excludeShinkansen: boolean;
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
  excludeShinkansen,
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
  // ただし新幹線は「日本全国」エリア限定ルールのため excludeShinkansen 時は除外する。
  const lineOptions = useMemo(
    () => buildLineOptions(network, { excludeShinkansen }),
    [network, excludeShinkansen]
  );

  // 降車駅候補は全駅（グループ＝物理駅単位で重複排除）。選択路線に依存しない静的リスト。
  // 同名別駅（例: 大阪と東京の京橋）は都道府県名の note で区別する（一意な駅名は note なし）。
  const stationOptions = useMemo(
    () => buildStationOptions(network, { excludeShinkansen }),
    [network, excludeShinkansen]
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
