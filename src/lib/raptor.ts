import { getNetworkIndex } from './networkIndex.ts';
import type { StationPatternRef } from './networkIndex.ts';
import type { AnswerMode, Itinerary, ItineraryLeg, Network } from './types.ts';

const MAX_ROUNDS = 8;
const INF = Number.POSITIVE_INFINITY;

/**
 * 経路復元用のラベル。あるラウンドである駅に「乗車」して降車（到達）した際に、
 * どの路線・パターン・乗車駅から来たかを記録する。
 * lineIdx が null の駅は、そのラウンドでは乗車由来の到達がなかったことを意味する。
 */
interface Label {
  /** この駅への降車到達値（乗換ペナルティを含まない、乗車のみの累積秒）。 */
  arrival: number;
  /** 乗車した路線index。null なら乗車由来ではない。 */
  lineIdx: number | null;
  /** 乗車駅（station index）。 */
  boardStation: number | null;
  /** 乗車駅での乗車準備値(ready)。rideSec = arrival - boardReady で復元する。 */
  boardReady: number | null;
}

interface RoundState {
  /** このラウンドでの各駅の降車到達値（乗換ペナルティを含まない）。乗車がなければ INF。 */
  arrival: Float64Array;
  /** このラウンドの到達ラベル（経路復元用）。 */
  labels: Label[];
  /**
   * このラウンドの乗車準備値(ready)。footpath 伝播後の値で、次ラウンドの乗車判定に使う。
   * ready[station] = 前ラウンドの降車到達値 + transferSec（同一グループ全駅へ伝播済み）。
   */
  ready: Float64Array;
  /**
   * readySource[station] = ready[station] を実際に生成した「降車駅」（同一グループ内、footpath元）。
   * 経路復元時、次ラウンドである駅で乗車した場合、その駅自身の同ラウンド内ラベルではなく
   * readySource で示される実際の降車駅のラベルを辿る必要がある
   * （footpathは同一グループ内の別駅の到達値から伝播されることがあるため）。
   */
  readySource: Int32Array;
}

/**
 * パターンを1方向にスキャンし、乗車・降車・再乗車を試みる（無向探索の片方向ぶん）。
 *
 * 【アルゴリズム上の注意】
 * このモデルの ready 値は「共通の時刻軸」ではなく、駅ごとに異なる経路由来の疑似経過秒であるため、
 * 標準的なRAPTORの「一度乗車したら、より早く乗れる乗り直し以外は乗車位置を再考しない」という
 * 貪欲法の前提（＝早く乗った方が必ず早く着く）が成立しない。
 * 例: 乗車位置Aのreadyが乗車位置Bのreadyより小さくても、AからBまでの区間秒がその差より大きければ、
 * Bで乗った方が目的駅に早く着きうる。
 * そのため「現在乗車中の1本を保持して乗り直し判定するだけ」の実装ではこのケースを取りこぼす。
 * 代わりに「walkedCum(=累積区間秒) - ready」を最小化するオフセット(bestOffset)を全走査済み駅から
 * 追跡し、各駅で candidate = bestOffset + walkedCum として、それまでの任意の乗車位置の中から
 * 真に最良のものを選ぶ。
 *
 * 環状パターン(isRing)は「実長 m = stops.length - 1」に対しモジュラー走査を行う。
 * 始端をまたぐ乗車（例: 品川(pos7)→東京(pos0)→神田(pos1)）を取りこぼさないよう、
 * 添字0から2周ぶん（2*m ステップ）走査する。walkedCumはラップさせず単調増加させ続けるため、
 * オフセット計算は非環状と同じロジックで扱える。
 * 非環状パターンは通常どおり端から端まで1回のみ走査する。
 *
 * @param forward true なら stops を前方向（index増加方向）、false なら後方向にスキャン
 */
function scanPattern(
  cum: number[],
  stops: number[],
  isRing: boolean,
  forward: boolean,
  prevReady: Float64Array,
  curArrival: Float64Array,
  curLabels: Label[],
  bestArrival: Float64Array,
  lineIdx: number,
  newlyImproved: Set<number>
): void {
  const len = stops.length;
  const m = isRing ? len - 1 : len; // 環状の実長（末尾再掲を除く）
  const totalSteps = isRing ? m * 2 : len;

  // walkedCum: 走査開始点からの累積区間秒（ラップさせず単調増加）。
  // bestOffset = walkedCum - ready の最小値（=最良の乗車位置を表すオフセット）。
  // candidate(alight) = bestOffset + walkedCum(alight) が、それまでの任意の乗車位置を考慮した最良到達値。
  let walkedCum = 0;
  let bestOffset: number | null = null;
  let bestOffsetBoardStation: number | null = null;
  let bestOffsetBoardReady: number | null = null;

  let prevPos = -1; // 直前ステップの配列添字（stops配列上、区間秒参照用）

  for (let step = 0; step < totalSteps; step++) {
    let pos: number;
    if (isRing) {
      // 環状: 添字0を起点にmod mで前進/後退する（始端またぎを2周ぶん走査してカバー）
      const rawIdx = forward ? step : -step;
      pos = ((rawIdx % m) + m) % m;
    } else {
      // 非環状: 前進は0->len-1、後退はlen-1->0を1回だけ走査する
      pos = forward ? step : len - 1 - step;
    }
    const stationIdx = stops[pos];

    // walkedCumの加算（直前添字からの1区間ぶん）
    if (prevPos !== -1 && prevPos !== pos) {
      walkedCum += segmentSeconds(cum, prevPos, pos, forward, isRing, m);
    }

    // ---- 降車判定: これまでの最良オフセットで現在駅への到達値を試みる ----
    if (bestOffset !== null) {
      const candidate = bestOffset + walkedCum;
      if (
        candidate < curArrival[stationIdx] &&
        candidate < bestArrival[stationIdx] &&
        bestOffsetBoardStation !== null &&
        bestOffsetBoardReady !== null
      ) {
        curArrival[stationIdx] = candidate;
        bestArrival[stationIdx] = candidate;
        curLabels[stationIdx] = {
          arrival: candidate,
          lineIdx,
          boardStation: bestOffsetBoardStation,
          boardReady: bestOffsetBoardReady,
        };
        newlyImproved.add(stationIdx);
      }
    }

    // ---- 乗車オフセット更新: 当駅のreadyが真に最良のオフセットを与えるか判定 ----
    const stationReady = prevReady[stationIdx];
    if (stationReady < INF) {
      const offset = stationReady - walkedCum;
      if (bestOffset === null || offset < bestOffset) {
        bestOffset = offset;
        bestOffsetBoardStation = stationIdx;
        bestOffsetBoardReady = stationReady;
      }
    }

    prevPos = pos;
  }
}

/** stops配列上の隣接添字 a -> b への1ステップぶんの区間秒を返す。 */
function segmentSeconds(
  cum: number[],
  a: number,
  b: number,
  forward: boolean,
  isRing: boolean,
  m: number
): number {
  if (!isRing) {
    return forward ? cum[b] - cum[a] : cum[a] - cum[b];
  }
  // 環状: 1ステップの隣接移動（モジュラー）。周回をまたぐ場合は cum[m]（一周分の総和）を使う。
  if (forward) {
    // a -> a+1（mod m）。a === m-1 のとき b===0 で周回をまたぐ。
    return a === m - 1 ? cum[m] - cum[a] : cum[a + 1] - cum[a];
  }
  // 後退: a -> a-1（mod m）。a === 0 のとき b===m-1 で周回をまたぐ。
  return a === 0 ? cum[a] + (cum[m] - cum[b]) : cum[a] - cum[a - 1];
}

/**
 * 指定ラウンドで乗換ペナルティを footpath として同一グループ内に伝播し、次ラウンドの ready を作る。
 * nextReadySource[member] には、その ready 値を実際に生み出した「降車駅」を記録する
 * （同一グループ内の別駅から伝播されることがあるため、経路復元時に正しい降車駅へ遡れるようにする）。
 *
 * 戻り値: ready が更新された（＝次ラウンドで乗車判定の起点となりうる）駅の集合。
 * これは乗車で改善した駅自身だけでなく、footpathで到達可能になった同一グループの全駅を含む。
 * 次ラウンドのスキャン対象パターン収集はこの集合の stationPatterns 逆引きを使うため、
 * footpath経由の駅を含めないと「乗換後の乗車」が発見できなくなる。
 */
function propagateFootpath(
  network: Network,
  arrival: Float64Array,
  improved: Iterable<number>,
  groupMembers: Map<number, number[]>,
  nextReady: Float64Array,
  nextReadySource: Int32Array
): Set<number> {
  const readyUpdated = new Set<number>();
  for (const stationIdx of improved) {
    const arr = arrival[stationIdx];
    if (arr === INF) continue;
    const group = network.stations[stationIdx].group;
    const members = groupMembers.get(group) ?? [stationIdx];
    const candidate = arr + network.transferSec;
    for (const member of members) {
      if (candidate < nextReady[member]) {
        nextReady[member] = candidate;
        nextReadySource[member] = stationIdx;
        readyUpdated.add(member);
      }
    }
  }
  return readyUpdated;
}

/**
 * from を起点に MAX_ROUNDS まで探索を実行し、各ラウンドの到達状態を返す。
 * ラウンドk（k>=1、rounds[k-1]に対応）= 乗車k回目（乗換k-1回）の到達状況。
 */
function runSearch(network: Network, from: number): RoundState[] {
  const index = getNetworkIndex(network);
  const n = network.stations.length;
  const fromGroup = network.stations[from].group;
  const groupMembers = index.groupMembers;

  const startMembers = groupMembers.get(fromGroup) ?? [from];

  // ラウンド1の乗車判定に使う ready: 起点グループ全駅 = 0（乗換ペナルティなしの初期状態）
  let prevReady = new Float64Array(n).fill(INF);
  for (const s of startMembers) {
    prevReady[s] = 0;
  }

  const rounds: RoundState[] = [];
  const bestArrival = new Float64Array(n).fill(INF);

  // ラウンド1でスキャンすべきパターンを得るための「改善済み駅集合」の初期値 = 起点グループ全体
  let improvedStations = new Set<number>(startMembers);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (improvedStations.size === 0) {
      break;
    }

    const curArrival = new Float64Array(n).fill(INF);
    const curLabels: Label[] = Array.from({ length: n }, () => ({
      arrival: INF,
      lineIdx: null,
      boardStation: null,
      boardReady: null,
    }));

    // 前ラウンドで改善された駅の stationPatterns 逆引きで、スキャン対象パターンを収集（全路線走査禁止）
    const seen = new Set<string>();
    const patternList: StationPatternRef[] = [];
    for (const stationIdx of improvedStations) {
      for (const ref of index.stationPatterns[stationIdx]) {
        const key = `${ref.line}:${ref.pattern}`;
        if (!seen.has(key)) {
          seen.add(key);
          patternList.push(ref);
        }
      }
    }

    const newlyImproved = new Set<number>();

    for (const { line: lineIdx, pattern: patternIdx } of patternList) {
      const pattern = network.lines[lineIdx].patterns[patternIdx];
      const cum = index.cumSec[lineIdx][patternIdx];
      const ring = index.isRing[lineIdx][patternIdx];
      const stops = pattern.stops;

      // パターンは無向: 前進・後退の両方向でスキャン
      scanPattern(cum, stops, ring, true, prevReady, curArrival, curLabels, bestArrival, lineIdx, newlyImproved);
      scanPattern(cum, stops, ring, false, prevReady, curArrival, curLabels, bestArrival, lineIdx, newlyImproved);
    }

    // footpath伝播: 今ラウンドで改善された駅から同一グループ全駅（自駅含む）へ ready = arrival + transferSec
    const nextReady = new Float64Array(n).fill(INF);
    const nextReadySource = new Int32Array(n).fill(-1);
    const readyUpdated = propagateFootpath(
      network,
      curArrival,
      newlyImproved,
      groupMembers,
      nextReady,
      nextReadySource
    );

    rounds.push({ arrival: curArrival, labels: curLabels, ready: nextReady, readySource: nextReadySource });

    prevReady = nextReady;
    // 次ラウンドのスキャン対象パターン収集には、footpathで ready が更新された駅すべてを使う
    // （乗車で改善した駅自身だけでは、乗換後に別路線へ乗車するケースを取りこぼす）。
    improvedStations = readyUpdated;
  }

  return rounds;
}

/** 指定ラウンドにおける、目的地グループ内で最良の到達駅・到達値を求める */
function bestArrivalForGroup(
  network: Network,
  round: RoundState,
  toGroup: number
): { station: number; arrival: number } | null {
  let best: { station: number; arrival: number } | null = null;
  for (let s = 0; s < network.stations.length; s++) {
    if (network.stations[s].group !== toGroup) continue;
    const arr = round.arrival[s];
    if (arr < INF && (best === null || arr < best.arrival)) {
      best = { station: s, arrival: arr };
    }
  }
  return best;
}

/**
 * あるラウンド・あるゴール駅到達のラベルを辿って Itinerary の legs を復元する。
 * ラベルは各ラウンドの labels に「乗車元(boardStation)・乗車readyの値(boardReady)」を持っているため、
 * rideSec = arrival - boardReady で乗車のみの所要秒（乗換ペナルティを含まない）を直接求められる。
 *
 * 重要: 乗車駅(boardStation)の ready 値は、必ずしも乗車駅自身の前ラウンド到達値ではなく、
 * 同一グループ内の別駅（footpath元）の到達値から伝播されている場合がある
 * （例: 乗換で他路線の別駅に降り立ち、そこから同グループの本来の乗車駅へ徒歩移動して乗車するケース）。
 * そのため、次ラウンドを遡る際は boardStation 自身ではなく、readySource[boardStation] が指す
 * 「実際にその ready を生んだ降車駅」からラベルを辿り直す必要がある。
 */
function reconstructLegs(rounds: RoundState[], round: number, goalStation: number): ItineraryLeg[] {
  const legs: ItineraryLeg[] = [];
  let curRound = round;
  let curStation = goalStation;

  while (curRound >= 1) {
    const label = rounds[curRound - 1].labels[curStation];
    if (label.lineIdx === null || label.boardStation === null || label.boardReady === null) {
      break;
    }
    const rideSec = label.arrival - label.boardReady;
    legs.push({
      line: label.lineIdx,
      from: label.boardStation,
      to: curStation,
      rideSec,
    });

    if (curRound === 1) {
      // ラウンド1の乗車は起点グループ（ready=0）由来なので、これ以上遡る前ラウンドは存在しない
      break;
    }

    // boardStation の ready を実際に生んだ降車駅（footpath元）を前ラウンドの readySource から求める
    const source = rounds[curRound - 2].readySource[label.boardStation];
    curStation = source !== -1 ? source : label.boardStation;
    curRound = curRound - 1;
  }

  legs.reverse();
  return legs;
}

/**
 * 出発駅 from から到着駅 to への経路を「駅間所要秒(segSec)」ベースで探索する。
 * from/to はどちらも station index。同一グループ内の全駅から出発／どの駅に着いてもゴール扱いとする。
 * 時刻の概念はなく、到達値は出発からの経過秒（起点グループの全駅=0）。
 *
 * mode ごとの解選択:
 * - 'time': 全ラウンドを通じて目的地グループへの最小到達値(arrival)。同値なら小ラウンド優先。
 * - 'transfers': 目的地グループに到達可能な最小ラウンド（＝最小乗換回数）。tie-breakはarrival。
 */
export function searchRoute(
  network: Network,
  from: number,
  to: number,
  mode: AnswerMode
): Itinerary | null {
  const fromGroup = network.stations[from].group;
  const toGroup = network.stations[to].group;

  // 出発グループ＝到着グループは経路探索として意味をなさないため不可扱いとする
  if (fromGroup === toGroup) {
    return null;
  }

  const rounds = runSearch(network, from);

  // 各ラウンドでの目的地グループへの最良到達を収集
  const perRoundBest: { round: number; station: number; arrival: number }[] = [];
  for (let r = 0; r < rounds.length; r++) {
    const best = bestArrivalForGroup(network, rounds[r], toGroup);
    if (best !== null) {
      perRoundBest.push({ round: r + 1, station: best.station, arrival: best.arrival });
    }
  }

  if (perRoundBest.length === 0) {
    return null;
  }

  let chosen: { round: number; station: number; arrival: number };

  if (mode === 'transfers') {
    // 最小ラウンド（＝最小乗換回数）。tie-breakはarrival。
    chosen = perRoundBest[0];
    for (const cand of perRoundBest) {
      if (
        cand.round < chosen.round ||
        (cand.round === chosen.round && cand.arrival < chosen.arrival)
      ) {
        chosen = cand;
      }
    }
  } else {
    // time: 全ラウンドを通じて最小到達値。同値なら小ラウンド優先。
    chosen = perRoundBest[0];
    for (const cand of perRoundBest) {
      if (
        cand.arrival < chosen.arrival ||
        (cand.arrival === chosen.arrival && cand.round < chosen.round)
      ) {
        chosen = cand;
      }
    }
  }

  const legs = reconstructLegs(rounds, chosen.round, chosen.station);
  if (legs.length === 0) {
    return null;
  }

  const rideSec = legs.reduce((sum, leg) => sum + leg.rideSec, 0);
  const transfers = legs.length - 1;
  const totalSec = rideSec + transfers * network.transferSec;

  return {
    legs,
    rideSec,
    totalSec,
    transfers,
  };
}
