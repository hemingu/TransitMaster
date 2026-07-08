import type { AnswerMode, Itinerary, ItineraryLeg, Network } from './types.ts';

const MAX_ROUNDS = 8;
const INF = Number.POSITIVE_INFINITY;

/**
 * 経路復元用のラベル。あるラウンドである駅に到達した際に、
 * どの路線・パターン・乗車駅・乗車時刻から来たかを記録する。
 * フットパス（同一グループ内乗換）で到達した場合は viaFootpathFrom に直前駅を記録する。
 */
interface Label {
  arrival: number;
  lineIdx: number | null;
  boardStation: number | null; // 乗車駅（station index）
  boardDep: number | null; // 乗車駅での出発時刻
  viaFootpathFrom: number | null; // フットパス元駅（非nullならフットパスで到達）
}

function emptyLabel(): Label {
  return {
    arrival: INF,
    lineIdx: null,
    boardStation: null,
    boardDep: null,
    viaFootpathFrom: null,
  };
}

interface RoundResult {
  // round k の各駅への最良到達時刻とラベル（k=0 は初期化ラウンド＝乗換0回、k>=1 は乗換k-1回）
  arrival: Float64Array;
  labels: Label[];
}

/**
 * pattern の trips の中から、stopPos で readyTime 以降に出発する最早のtripのindexを返す。
 * trips は先頭停車駅の時刻昇順にソート済み（buildNetworkの実装）で、GTFSダイヤは
 * 通常追い越しがない前提のため、各停車位置の時刻列も同順であるとみなして線形探索する。
 */
function findBoardableTrip(trips: number[][], stopPos: number, readyTime: number): number | null {
  for (let t = 0; t < trips.length; t++) {
    if (trips[t][stopPos] >= readyTime) {
      return t;
    }
  }
  return null;
}

/**
 * 標準的なラウンドベースRAPTORを実行し、各ラウンドの到達時刻・復元ラベルを返す。
 * ラウンド0 = 初期化（乗換0回、出発グループの全駅がdepartSecで利用可能）
 * ラウンドk（k>=1） = 乗換k-1回で到達可能な最良到達時刻。
 */
function runRaptor(network: Network, from: number, departSec: number): RoundResult[] {
  const n = network.stations.length;
  const fromGroup = network.stations[from].group;
  const transferSec = network.transferSec;

  // グループ -> 所属駅一覧（同一グループ内フットパス伝播用）
  const groupMembers = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const g = network.stations[i].group;
    const arr = groupMembers.get(g) ?? [];
    arr.push(i);
    groupMembers.set(g, arr);
  }

  const rounds: RoundResult[] = [];

  // ---- ラウンド0: 初期化（出発グループの全駅がペナルティなしで出発可能） ----
  const round0Arrival = new Float64Array(n).fill(INF);
  const round0Labels: Label[] = Array.from({ length: n }, () => emptyLabel());
  const startMembers = groupMembers.get(fromGroup) ?? [from];
  for (const s of startMembers) {
    round0Arrival[s] = departSec;
    round0Labels[s].arrival = departSec;
  }
  rounds.push({ arrival: round0Arrival, labels: round0Labels });

  // best[] = 全ラウンドを通じた各駅への最良到達時刻（RAPTORの枝刈り・単調性維持用）
  const best = new Float64Array(n).fill(INF);
  for (const s of startMembers) best[s] = departSec;

  let markedStations = new Set<number>(startMembers);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const prevArrival = rounds[round - 1].arrival;

    if (markedStations.size === 0) {
      break;
    }

    // このラウンドは前ラウンドの到達状況を引き継いだ状態から改善を試みる
    const curArrival = new Float64Array(prevArrival);
    const curLabels: Label[] = rounds[round - 1].labels.map((l) => ({ ...l }));

    // マークされた駅を通る (line, pattern) を収集
    const relevantPatterns: { lineIdx: number; patternIdx: number }[] = [];
    for (let lineIdx = 0; lineIdx < network.lines.length; lineIdx++) {
      const line = network.lines[lineIdx];
      for (let patternIdx = 0; patternIdx < line.patterns.length; patternIdx++) {
        const pattern = line.patterns[patternIdx];
        if (pattern.stops.some((stop) => markedStations.has(stop))) {
          relevantPatterns.push({ lineIdx, patternIdx });
        }
      }
    }

    const newlyMarked = new Set<number>();

    for (const { lineIdx, patternIdx } of relevantPatterns) {
      const pattern = network.lines[lineIdx].patterns[patternIdx];
      const stops = pattern.stops;
      const trips = pattern.trips;

      let activeTripIdx: number | null = null;
      let boardStopIdx: number | null = null;
      let boardStation: number | null = null;

      for (let stopPos = 0; stopPos < stops.length; stopPos++) {
        const stationIdx = stops[stopPos];

        // 既に乗車中のtripがあれば、この駅での到着で改善を試みる
        if (activeTripIdx !== null) {
          const arr = trips[activeTripIdx][stopPos];
          if (arr < curArrival[stationIdx] && arr < best[stationIdx]) {
            curArrival[stationIdx] = arr;
            best[stationIdx] = arr;
            curLabels[stationIdx] = {
              arrival: arr,
              lineIdx,
              boardStation,
              boardDep: boardStopIdx !== null ? trips[activeTripIdx][boardStopIdx] : null,
              viaFootpathFrom: null,
            };
            newlyMarked.add(stationIdx);
          }
        }

        // この駅でより早いtripに乗車できるか判定
        // ラウンド1: 前ラウンド(=ラウンド0の初期化)到着時刻そのもので乗車可能（乗換ペナルティなし）
        // ラウンド2以降: 前ラウンド到着時刻 + transferSec 後から乗車可能
        const prevArr = prevArrival[stationIdx];
        if (prevArr < INF) {
          const readyTime = round === 1 ? prevArr : prevArr + transferSec;
          const candidateTripIdx = findBoardableTrip(trips, stopPos, readyTime);
          if (candidateTripIdx !== null) {
            const alreadyBoardedDep =
              activeTripIdx !== null ? trips[activeTripIdx][stopPos] : null;
            const candidateDep = trips[candidateTripIdx][stopPos];
            if (alreadyBoardedDep === null || candidateDep < alreadyBoardedDep) {
              activeTripIdx = candidateTripIdx;
              boardStopIdx = stopPos;
              boardStation = stationIdx;
            }
          }
        }
      }
    }

    // ---- フットパス伝播: 乗車で改善された駅から同一グループ内の他駅へ transferSec で伝播 ----
    const footpathMarked = new Set<number>();
    for (const stationIdx of newlyMarked) {
      const arr = curArrival[stationIdx];
      const group = network.stations[stationIdx].group;
      const members = groupMembers.get(group) ?? [];
      for (const other of members) {
        if (other === stationIdx) continue;
        const candidate = arr + transferSec;
        if (candidate < curArrival[other] && candidate < best[other]) {
          curArrival[other] = candidate;
          best[other] = candidate;
          curLabels[other] = {
            arrival: candidate,
            lineIdx: null,
            boardStation: null,
            boardDep: null,
            viaFootpathFrom: stationIdx,
          };
          footpathMarked.add(other);
        }
      }
    }
    for (const s of footpathMarked) newlyMarked.add(s);

    rounds.push({ arrival: curArrival, labels: curLabels });
    markedStations = newlyMarked;
  }

  return rounds;
}

/** 指定ラウンドにおける、目的地グループ内で最良の到達駅・到着時刻を求める */
function bestArrivalForGroup(
  network: Network,
  rounds: RoundResult[],
  round: number,
  toGroup: number
): { station: number; arrival: number } | null {
  const arrival = rounds[round].arrival;
  let best: { station: number; arrival: number } | null = null;
  for (let s = 0; s < network.stations.length; s++) {
    if (network.stations[s].group !== toGroup) continue;
    if (arrival[s] < INF && (best === null || arrival[s] < best.arrival)) {
      best = { station: s, arrival: arrival[s] };
    }
  }
  return best;
}

/** あるラウンド・あるゴール駅到達のラベルを辿って Itinerary の legs を復元する */
function reconstructLegs(
  rounds: RoundResult[],
  round: number,
  goalStation: number
): ItineraryLeg[] {
  const legs: ItineraryLeg[] = [];
  let curRound = round;
  let curStation = goalStation;

  while (curRound > 0) {
    const label = rounds[curRound].labels[curStation];
    if (label.viaFootpathFrom !== null) {
      // フットパスは leg を生成しない。同ラウンド内で乗車元を辿り続ける。
      curStation = label.viaFootpathFrom;
      continue;
    }
    if (label.lineIdx !== null && label.boardStation !== null && label.boardDep !== null) {
      legs.push({
        line: label.lineIdx,
        from: label.boardStation,
        to: curStation,
        dep: label.boardDep,
        arr: label.arrival,
      });
      curStation = label.boardStation;
      curRound = curRound - 1;
      continue;
    }
    // ラベルが空（起点駅）でこれ以上遡れない
    break;
  }

  legs.reverse();
  return legs;
}

function computeFare(network: Network, legs: ItineraryLeg[]): number | null {
  let total = 0;
  for (const leg of legs) {
    const fare = network.lines[leg.line].fare;
    if (fare === null) return null;
    total += fare;
  }
  return total;
}

/**
 * 出発駅 from から到着駅 to への経路を RAPTOR で探索する。
 * from/to はどちらも station index。同一グループ内の全駅から出発／どの駅に着いてもゴール扱いとする。
 *
 * mode ごとの解選択:
 * - 'time': 全ラウンドを通じて到着時刻が最小の解
 * - 'transfers': 目的地に到達する最小ラウンド（＝最小乗換回数）の解。同ラウンドなら到着時刻で tie-break
 * - 'fare': 各ラウンドの最良到達解のうち fare が算出可能なものの中で最安。同額なら到着時刻。
 *           fare 算出可能な候補が一つもなければ 'time' と同じ解を fare:null で返す
 */
export function searchRoute(
  network: Network,
  from: number,
  to: number,
  departSec: number,
  mode: AnswerMode
): Itinerary | null {
  const toGroup = network.stations[to].group;
  const fromGroup = network.stations[from].group;

  // 出発グループ＝到着グループは経路探索として意味をなさないため不可扱いとする
  if (fromGroup === toGroup) {
    return null;
  }

  const rounds = runRaptor(network, from, departSec);

  // 各ラウンドでの目的地グループへの最良到達を収集（乗車を伴わないラウンド0は除外）
  const perRoundBest: { round: number; station: number; arrival: number }[] = [];
  for (let r = 1; r < rounds.length; r++) {
    const best = bestArrivalForGroup(network, rounds, r, toGroup);
    if (best !== null) {
      perRoundBest.push({ round: r, station: best.station, arrival: best.arrival });
    }
  }

  if (perRoundBest.length === 0) {
    return null;
  }

  const pickBestByTime = (): { round: number; station: number; arrival: number } => {
    let chosen = perRoundBest[0];
    for (const cand of perRoundBest) {
      if (
        cand.arrival < chosen.arrival ||
        (cand.arrival === chosen.arrival && cand.round < chosen.round)
      ) {
        chosen = cand;
      }
    }
    return chosen;
  };

  let chosen: { round: number; station: number; arrival: number };

  if (mode === 'transfers') {
    // 最小ラウンド（＝最小乗換回数）。同ラウンドなら到着時刻最小（perRoundBestは各ラウンドで既に最良到着時刻）
    chosen = perRoundBest[0];
    for (const cand of perRoundBest) {
      if (cand.round < chosen.round) chosen = cand;
    }
  } else if (mode === 'time') {
    chosen = pickBestByTime();
  } else {
    // fare モード: 各ラウンドの最良解（Pareto候補）から fare 非null の中で最安。tieは到着時刻。
    let bestFareChosen: { round: number; station: number; arrival: number; fare: number } | null =
      null;
    for (const cand of perRoundBest) {
      const legs = reconstructLegs(rounds, cand.round, cand.station);
      const fare = computeFare(network, legs);
      if (fare === null) continue;
      if (
        bestFareChosen === null ||
        fare < bestFareChosen.fare ||
        (fare === bestFareChosen.fare && cand.arrival < bestFareChosen.arrival)
      ) {
        bestFareChosen = { round: cand.round, station: cand.station, arrival: cand.arrival, fare };
      }
    }
    chosen = bestFareChosen ?? pickBestByTime();
  }

  const legs = reconstructLegs(rounds, chosen.round, chosen.station);
  if (legs.length === 0) {
    return null;
  }

  const fare = computeFare(network, legs);

  return {
    legs,
    depart: legs[0].dep,
    arrive: legs[legs.length - 1].arr,
    transfers: legs.length - 1,
    fare,
  };
}
