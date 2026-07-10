import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import { SetupScreen } from './components/SetupScreen.tsx';
import { RouteBuilderScreen } from './components/RouteBuilderScreen.tsx';
import { ResultScreen } from './components/ResultScreen.tsx';
import { useRoutingWorker } from './components/useRoutingWorker.ts';
import { type AreaId, stationsInArea } from './lib/area.ts';
import {
  type Difficulty,
  type Judgement,
  difficultyToTransferRange,
  judgeAnswer,
} from './lib/game.ts';
import { generateQuestion } from './lib/question.ts';
import { evaluateRoute, validateRoute } from './lib/validate.ts';
import type { AnswerMode, Itinerary, Network, RouteEvaluation, RouteLeg } from './lib/types.ts';

type Screen = 'loading' | 'setup' | 'building' | 'result';

interface QuestionState {
  origin: number;
  destination: number;
}

interface AnswerResult {
  valid: boolean;
  invalidReason?: string;
  invalidLegIndex?: number;
  evaluation: RouteEvaluation | null;
}

const AREA_ORDER: AreaId[] = ['tokyo23', 'tokyo', 'nagoya', 'osaka', 'japan'];

function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [network, setNetwork] = useState<Network | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [area, setArea] = useState<AreaId>('tokyo23');
  const [mode, setMode] = useState<AnswerMode>('time');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
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
        if (data.formatVersion !== 2) {
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
      nagoya: 0,
      osaka: 0,
      japan: 0,
    };
    if (!network) return counts;
    for (const id of AREA_ORDER) {
      counts[id] = stationsInArea(network, id).length;
    }
    return counts;
  }, [network]);

  function startQuestion() {
    if (!network) return;
    const areaStations = stationsInArea(network, area);
    const { minTransfers, maxTransfers } = difficultyToTransferRange(difficulty);
    const q = generateQuestion(network, areaStations, { minTransfers, maxTransfers });
    if (!q) {
      setSetupError(
        '条件に合う出題を作成できませんでした。エリアまたは難易度を変えてお試しください。'
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

  async function handleSubmit() {
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
      return;
    }

    const evaluation = evaluateRoute(network, legs);
    setAnswerResult({ valid: true, evaluation });
    setTotalAnswered((n) => n + 1);
    setTotalCorrect((n) => n + 1);
    setStreak((n) => n + 1);
    setScreen('result');

    setReferenceLoading(true);
    setReference(null);
    setJudgement(null);
    const itinerary = await search(question.origin, question.destination, mode);
    setReference(itinerary);
    setJudgement(judgeAnswer(mode, evaluation, itinerary));
    setReferenceLoading(false);
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
        onStart={startQuestion}
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
