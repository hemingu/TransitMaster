import { AREA_LABELS, type AreaId } from '../lib/area.ts';
import { DIFFICULTY_LABELS, type Difficulty } from '../lib/game.ts';
import { STATION_SCALE_LABELS, type StationScale, hasRidershipData } from '../lib/stationScale.ts';
import type { AnswerMode, Network } from '../lib/types.ts';

const ANSWER_MODE_LABELS: Record<AnswerMode, string> = {
  time: '最短時間',
  transfers: '最小乗換',
};

const AREA_ORDER: AreaId[] = ['tokyo23', 'tokyo', 'mt3d'];
const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
const STATION_SCALE_ORDER: StationScale[] = ['major', 'medium', 'all'];
const ANSWER_MODE_ORDER: AnswerMode[] = ['time', 'transfers'];

const MIN_STATIONS_FOR_AREA = 10;

interface SetupScreenProps {
  network: Network;
  areaStationCounts: Record<AreaId, number>;
  area: AreaId;
  onAreaChange: (area: AreaId) => void;
  mode: AnswerMode;
  onModeChange: (mode: AnswerMode) => void;
  difficulty: Difficulty;
  onDifficultyChange: (difficulty: Difficulty) => void;
  stationScale: StationScale;
  onStationScaleChange: (scale: StationScale) => void;
  onStart: () => void;
  errorMessage: string | null;
}

export function SetupScreen({
  network,
  areaStationCounts,
  area,
  onAreaChange,
  mode,
  onModeChange,
  difficulty,
  onDifficultyChange,
  stationScale,
  onStationScaleChange,
  onStart,
  errorMessage,
}: SetupScreenProps) {
  const ridershipAvailable = hasRidershipData(network);
  return (
    <div className="screen setup-screen">
      <h1>人力路線検索マスター</h1>
      <p className="lead">エリア・模範解答モード・乗換回数・駅の規模を選んでゲームを開始しよう。</p>

      <section className="setup-group">
        <h2>エリア</h2>
        <div className="choice-grid">
          {AREA_ORDER.map((id) => {
            const count = areaStationCounts[id] ?? 0;
            const disabled = count < MIN_STATIONS_FOR_AREA;
            return (
              <button
                key={id}
                type="button"
                className={`choice-button${area === id ? ' selected' : ''}`}
                disabled={disabled}
                aria-pressed={area === id}
                onClick={() => onAreaChange(id)}
              >
                <span>{AREA_LABELS[id]}</span>
                {disabled && <span className="choice-note">データ未収録</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="setup-group">
        <h2>模範解答モード</h2>
        <div className="choice-grid">
          {ANSWER_MODE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={`choice-button${mode === id ? ' selected' : ''}`}
              aria-pressed={mode === id}
              onClick={() => onModeChange(id)}
            >
              <span>{ANSWER_MODE_LABELS[id]}</span>
            </button>
          ))}
        </div>
        <p className="setup-note">
          模範解答は乗車券のみで乗れる列車（無料の列車）で計算しています。有料特急・座席指定ライナーは使用しません。
        </p>
      </section>

      <section className="setup-group">
        <h2>乗換回数</h2>
        <div className="choice-grid">
          {DIFFICULTY_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={`choice-button${difficulty === id ? ' selected' : ''}`}
              aria-pressed={difficulty === id}
              onClick={() => onDifficultyChange(id)}
            >
              <span>{DIFFICULTY_LABELS[id]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="setup-group">
        <h2>駅の規模（乗降客数）</h2>
        <div className="choice-grid">
          {STATION_SCALE_ORDER.map((id) => {
            const disabled = id !== 'all' && !ridershipAvailable;
            return (
              <button
                key={id}
                type="button"
                className={`choice-button${stationScale === id ? ' selected' : ''}`}
                disabled={disabled}
                aria-pressed={stationScale === id}
                onClick={() => onStationScaleChange(id)}
              >
                <span>{STATION_SCALE_LABELS[id]}</span>
                {disabled && <span className="choice-note">データ未収録</span>}
              </button>
            );
          })}
        </div>
        <p className="setup-note">
          出発駅・到着駅の両方が、選んだエリア内で乗降客数の多い駅（主要駅のみ＝上位20%、中規模駅まで＝上位60%）になります。
        </p>
      </section>

      {errorMessage && <p className="error-message">{errorMessage}</p>}

      <button type="button" className="primary-button start-button" onClick={onStart}>
        ゲームを始める
      </button>

      <p className="credit">
        データ出典：
        <a href="https://github.com/nagix/mini-tokyo-3d" target="_blank" rel="noopener noreferrer">
          Mini Tokyo 3D (MIT)
        </a>
        、
        <a
          href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-S12-2024.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          国土数値情報 駅別乗降客数データ
        </a>
        （国土交通省, CC BY 4.0）
      </p>
    </div>
  );
}
