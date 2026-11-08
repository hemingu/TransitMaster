import { AREA_LABELS, type AreaId } from '../lib/area.ts';
import { DIFFICULTY_LABELS, type Difficulty } from '../lib/game.ts';
import type { AnswerMode, Network } from '../lib/types.ts';

const ANSWER_MODE_LABELS: Record<AnswerMode, string> = {
  time: '最短時間',
  transfers: '最小乗換',
};

const AREA_ORDER: AreaId[] = ['tokyo23', 'tokyo', 'mt3d'];
const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
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
  onStart: () => void;
  errorMessage: string | null;
}

export function SetupScreen({
  areaStationCounts,
  area,
  onAreaChange,
  mode,
  onModeChange,
  difficulty,
  onDifficultyChange,
  onStart,
  errorMessage,
}: SetupScreenProps) {
  return (
    <div className="screen setup-screen">
      <h1>人力路線検索マスター</h1>
      <p className="lead">エリア・模範解答モード・難易度を選んでゲームを開始しよう。</p>

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
        <h2>難易度</h2>
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

      {errorMessage && <p className="error-message">{errorMessage}</p>}

      <button type="button" className="primary-button start-button" onClick={onStart}>
        ゲームを始める
      </button>

      <p className="credit">
        <a href="https://github.com/nagix/mini-tokyo-3d" target="_blank" rel="noopener noreferrer">
          Mini Tokyo 3D (MIT)
        </a>
      </p>
    </div>
  );
}
