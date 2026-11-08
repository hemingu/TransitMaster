import { AREA_LABELS, type AreaId } from '../lib/area.ts';
import { CHALLENGE_DIFFICULTY_LABELS } from '../lib/challenge.ts';
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

export type GameMode = 'challenge' | 'free';

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
  gameMode: GameMode | null;
  onGameModeChange: (gameMode: GameMode) => void;
  onStart: () => void;
  onStartChallenge: () => void;
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
  gameMode,
  onGameModeChange,
  onStart,
  onStartChallenge,
  errorMessage,
}: SetupScreenProps) {
  const ridershipAvailable = hasRidershipData(network);
  return (
    <div className="screen setup-screen">
      <h1>人力路線検索マスター</h1>
      <p className="lead">遊ぶモードを選んでゲームを開始しよう。</p>

      <section className="setup-group">
        <div className="game-mode-grid">
          <button
            type="button"
            className={`game-mode-button${gameMode === 'challenge' ? ' selected' : ''}`}
            aria-pressed={gameMode === 'challenge'}
            onClick={() => onGameModeChange('challenge')}
          >
            <span className="game-mode-title">チャレンジモード</span>
            <span className="game-mode-desc">東京23区で10問。結果をXでシェア</span>
          </button>
          <button
            type="button"
            className={`game-mode-button${gameMode === 'free' ? ' selected' : ''}`}
            aria-pressed={gameMode === 'free'}
            onClick={() => onGameModeChange('free')}
          >
            <span className="game-mode-title">フリーモード</span>
            <span className="game-mode-desc">エリアや条件を自由に設定して1問ずつ遊ぶ</span>
          </button>
        </div>
      </section>


      {gameMode === 'free' && (
        <>
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
        </>
      )}

      {gameMode === 'challenge' && (
        <>
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
                <span>{CHALLENGE_DIFFICULTY_LABELS[id]}</span>
              </button>
            ))}
          </div>
        </section>


          <h3 className="challenge-rules-title">ルール</h3>
          <ul className="setup-note challenge-rules">
            <li>出発駅と到着駅が示されるので、最小の乗換回数となるルートを解答する。</li>
            <li>
              ただし、有料特急や座席指定ライナーなどは使用せず、乗車券のみで乗れる列車のみでルートを構成する。
            </li>
          </ul>

          {errorMessage && <p className="error-message">{errorMessage}</p>}

          <button type="button" className="primary-button start-button" onClick={onStartChallenge}>
            チャレンジを始める
          </button>
        </>
      )}

      <p className="credit">
        データ出典：
        <a href="https://github.com/nagix/mini-tokyo-3d" target="_blank" rel="noopener noreferrer">
          Mini Tokyo 3D
        </a>
        {' (MIT)、'}
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
