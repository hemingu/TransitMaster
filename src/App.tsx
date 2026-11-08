import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import './App.css';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import { ChallengeResultScreen } from './components/ChallengeResultScreen.tsx';
import { SetupScreen, type GameMode } from './components/SetupScreen.tsx';
import { RouteBuilderScreen } from './components/RouteBuilderScreen.tsx';
import { ResultScreen } from './components/ResultScreen.tsx';
import { useRoutingWorker } from './components/useRoutingWorker.ts';
import { type AreaId, stationsInArea } from './lib/area.ts';
import {
  CHALLENGE_MODE,
  CHALLENGE_QUESTION_COUNT,
  CHALLENGE_TRANSFER_RANGE,
  challengeReducer,
  challengeStations,
} from './lib/challenge.ts';
import {
  type Difficulty,
  type Judgement,
  difficultyToTransferRange,
  judgeAnswer,
} from './lib/game.ts';
import { generateQuestion } from './lib/question.ts';
import { type StationScale, filterStationsByScale } from './lib/stationScale.ts';
import { evaluateRoute, validateRoute } from './lib/validate.ts';
import type { AnswerMode, Itinerary, Network, RouteEvaluation, RouteLeg } from './lib/types.ts';

type Screen = 'loading' | 'setup' | 'building' | 'result' | 'challengeResult';

/** チャレンジモードの固定条件 */

interface QuestionState {
  origin: number;
  destination: number;
}

interface AnswerResult {
  valid: boolean;
  invalidReason?: string;
  invalidLegIndex?: number;
  skipped?: boolean;
  evaluation: RouteEvaluation | null;
}

const AREA_ORDER: AreaId[] = ['tokyo23', 'tokyo', 'mt3d'];

function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [network, setNetwork] = useState<Network | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [area, setArea] = useState<AreaId>('tokyo23');
  const [mode, setMode] = useState<AnswerMode>('time');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [stationScale, setStationScale] = useState<StationScale>('all');
  const [gameMode, setGameMode] = useState<GameMode | null>(null);
  const [challenge, dispatchChallenge] = useReducer(challengeReducer, null);
  /** 現在のチャレンジの通し番号（0 = チャレンジ中ではない）。非同期の模範解答が古いチャレンジに混ざらないよう照合する */
  const challengeIdRef = useRef(0);
  const challengeCounter = useRef(0);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [question, setQuestion] = useState<QuestionState | null>(null);
  const [legs, setLegs] = useState<RouteLeg[]>([]);
  const [currentStation, setCurrentStation] = useState<number | null>(null);

  const [streak, setStreak] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);

  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [reference, setReference] = useState<Itinerary | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [judgement, setJudgement] = useState<Judgement | null>(null);

  const { search } = useRoutingWorker(network);

  // ---- ロード ----
  useEffect(() => {
    let cancelled = false;
    fetch(import.meta.env.BASE_URL + 'data/network.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Network & { formatVersion?: number }) => {
        if (cancelled) return;
        if (data.formatVersion !== 3) {
          setLoadError(
            'network.json の形式が古いです。npm run build:network を実行してください。'
          );
          return;
        }
        setNetwork(data);
        setScreen('setup');
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('路線データの読み込みに失敗しました。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const areaStationCounts = useMemo(() => {
    const counts: Record<AreaId, number> = {
      tokyo23: 0,
      tokyo: 0,
      mt3d: 0,
    };
    if (!network) return counts;
    for (const id of AREA_ORDER) {
      counts[id] = stationsInArea(network, id).length;
    }
    return counts;
  }, [network]);

  /** チャレンジを開始（または同じ難易度で再開）する。 */
  function startChallenge() {
    if (!network) return;
    const id = ++challengeCounter.current;
    challengeIdRef.current = id;
    dispatchChallenge({ type: 'start', id, difficulty });
    if (!startChallengeQuestion([])) {
      challengeIdRef.current = 0;
      dispatchChallenge({ type: 'clear' });
    }
  }

  /** チャレンジの次の問題を出題する（同じ出発駅・到着駅の組を重複させない）。作れなければ false。 */
  function startChallengeQuestion(used: { origin: number; destination: number }[]): boolean {
    if (!network) return false;
    const stations = challengeStations(network, difficulty);
    const { minTransfers, maxTransfers } = CHALLENGE_TRANSFER_RANGE;
    const isUsed = (o: number, d: number) =>
      used.some(
        (u) => (u.origin === o && u.destination === d) || (u.origin === d && u.destination === o)
      );
    for (let attempt = 0; attempt < 30; attempt++) {
      const q = generateQuestion(network, stations, { minTransfers, maxTransfers });
      if (!q) break;
      if (isUsed(q.origin, q.destination)) continue;
      setSetupError(null);
      setQuestion({ origin: q.origin, destination: q.destination });
      setLegs([]);
      setCurrentStation(q.origin);
      setScreen('building');
      return true;
    }
    setSetupError('条件に合う出題を作成できませんでした。');
    setScreen('setup');
    return false;
  }

  function startQuestion() {
    if (!network) return;
    const areaStations = filterStationsByScale(network, stationsInArea(network, area), stationScale);
    const { minTransfers, maxTransfers } = difficultyToTransferRange(difficulty);
    const q = generateQuestion(network, areaStations, {
      minTransfers,
      maxTransfers,
    });
    if (!q) {
      setSetupError(
        '条件に合う出題を作成できませんでした。エリア・乗換回数・駅の規模のいずれかを緩めてお試しください。'
      );
      return;
    }
    setSetupError(null);
    setQuestion({ origin: q.origin, destination: q.destination });
    setLegs([]);
    setCurrentStation(q.origin);
    setAnswerResult(null);
    setReference(null);
    setJudgement(null);
    setScreen('building');
  }

  function handleAddLeg(leg: RouteLeg) {
    setLegs((prev) => [...prev, leg]);
    setCurrentStation(leg.to);
  }

  function handleUndo() {
    setLegs((prev) => {
      const next = prev.slice(0, -1);
      const newCurrent = next.length > 0 ? next[next.length - 1].to : (question?.origin ?? null);
      setCurrentStation(newCurrent);
      return next;
    });
  }

  function handleReset() {
    setLegs([]);
    setCurrentStation(question?.origin ?? null);
  }

  /** 模範解答をワーカーで探索して reference にセットする（探索中は referenceLoading を立てる）。 */
  async function loadReference(origin: number, destination: number): Promise<Itinerary | null> {
    setReferenceLoading(true);
    setReference(null);
    setJudgement(null);
    const itinerary = await search(origin, destination, mode);
    setReference(itinerary);
    return itinerary;
  }

  /** チャレンジモードの回答: 結果画面を挟まず記録して次の問題へ。模範解答はバックグラウンドで計算する。 */
  function handleChallengeSubmit(skipped = false) {
    if (!network || !question || !challenge) return;
    const id = challengeIdRef.current;
    const index = challenge.records.length;
    const validation = skipped
      ? null
      : validateRoute(network, question.origin, question.destination, legs);
    dispatchChallenge({
      type: 'answer',
      id,
      record: {
        origin: question.origin,
        destination: question.destination,
        legs: skipped ? [] : legs,
        valid: validation?.valid ?? false,
        skipped,
        invalidReason: validation && !validation.valid ? validation.reason : undefined,
        invalidLegIndex: validation && !validation.valid ? validation.legIndex : undefined,
        evaluation:
          validation?.valid ? evaluateRoute(network, legs, CHALLENGE_MODE) : null,
      },
    });
    // 待たずに次へ進み、模範解答は届いた時点で記録に反映する（古いチャレンジの結果はリデューサーが無視）
    void search(question.origin, question.destination, CHALLENGE_MODE).then((itinerary) => {
      dispatchChallenge({ type: 'reference', id, index, itinerary });
    });

    const used = [
      ...challenge.records,
      { origin: question.origin, destination: question.destination },
    ];
    if (used.length >= CHALLENGE_QUESTION_COUNT) {
      setQuestion(null);
      setScreen('challengeResult');
    } else {
      startChallengeQuestion(used);
    }
  }

  async function handleSubmit() {
    if (challenge) {
      handleChallengeSubmit();
      return;
    }
    if (!network || !question) return;

    const validation = validateRoute(network, question.origin, question.destination, legs);

    if (!validation.valid) {
      setAnswerResult({
        valid: false,
        invalidReason: validation.reason,
        invalidLegIndex: validation.legIndex,
        evaluation: null,
      });
      setTotalAnswered((n) => n + 1);
      setStreak(0);
      setScreen('result');

      // 経路が無効でも「正しくはどう行くのか」を学べるよう模範解答は表示する（judgement は null のまま）
      await loadReference(question.origin, question.destination);
      setReferenceLoading(false);
      return;
    }

    const evaluation = evaluateRoute(network, legs, mode);
    setAnswerResult({ valid: true, evaluation });
    setTotalAnswered((n) => n + 1);
    setScreen('result');

    const itinerary = await loadReference(question.origin, question.destination);
    const judged = judgeAnswer(mode, evaluation, itinerary);
    setJudgement(judged);
    // 「正解」はパーフェクト（模範解答と同等以下）のみ。close/miss は連続正解をリセットする
    if (judged.level === 'perfect') {
      setTotalCorrect((n) => n + 1);
      setStreak((n) => n + 1);
    } else {
      setStreak(0);
    }
    setReferenceLoading(false);
  }

  /** 回答スキップ: チャレンジでは不正解として記録して次へ、フリーでは結果画面（模範解答のみ）を表示する。 */
  async function handleSkip() {
    if (challenge) {
      handleChallengeSubmit(true);
      return;
    }
    if (!network || !question) return;
    setLegs([]);
    setAnswerResult({ valid: false, skipped: true, evaluation: null });
    setTotalAnswered((n) => n + 1);
    setStreak(0);
    setScreen('result');
    await loadReference(question.origin, question.destination);
    setReferenceLoading(false);
  }

  function handleBackToTop() {
    challengeIdRef.current = 0;
    dispatchChallenge({ type: 'clear' });
    setQuestion(null);
    setLegs([]);
    setCurrentStation(null);
    setAnswerResult(null);
    setReference(null);
    setJudgement(null);
    setSetupError(null);
    setScreen('setup');
  }

  function handleNext() {
    startQuestion();
  }

  if (screen === 'loading' || !network) {
    return <LoadingScreen error={loadError} />;
  }

  if (screen === 'setup') {
    return (
      <SetupScreen
        network={network}
        areaStationCounts={areaStationCounts}
        area={area}
        onAreaChange={setArea}
        mode={mode}
        onModeChange={setMode}
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        stationScale={stationScale}
        onStationScaleChange={setStationScale}
        gameMode={gameMode}
        onGameModeChange={setGameMode}
        onStart={startQuestion}
        onStartChallenge={startChallenge}
        errorMessage={setupError}
      />
    );
  }

  if (screen === 'building' && question && currentStation !== null) {
    return (
      <RouteBuilderScreen
        network={network}
        origin={question.origin}
        destination={question.destination}
        streak={streak}
        totalCorrect={totalCorrect}
        totalAnswered={totalAnswered}
        legs={legs}
        currentStation={currentStation}
        onAddLeg={handleAddLeg}
        onUndo={handleUndo}
        onReset={handleReset}
        onSubmit={handleSubmit}
        onSkip={handleSkip}
        onBackToTop={handleBackToTop}
        challengeProgress={
          challenge
            ? { current: challenge.records.length + 1, total: CHALLENGE_QUESTION_COUNT }
            : undefined
        }
      />
    );
  }

  if (screen === 'challengeResult' && challenge) {
    return (
      <ChallengeResultScreen
        network={network}
        challenge={challenge}
        onRetry={startChallenge}
        onBackToTop={handleBackToTop}
      />
    );
  }

  if (screen === 'result' && answerResult) {
    return (
      <ResultScreen
        network={network}
        mode={mode}
        legs={legs}
        streak={streak}
        totalCorrect={totalCorrect}
        totalAnswered={totalAnswered}
        valid={answerResult.valid}
        invalidReason={answerResult.invalidReason}
        invalidLegIndex={answerResult.invalidLegIndex}
        endpoints={question ?? undefined}
        skipped={answerResult.skipped}
        evaluation={answerResult.evaluation}
        reference={reference}
        judgement={judgement}
        referenceLoading={referenceLoading}
        onNext={handleNext}
      />
    );
  }

  return <LoadingScreen error={loadError} />;
}

export default App;
