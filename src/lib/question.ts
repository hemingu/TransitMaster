import type { Network } from './types.ts';
import { LINK_SEGMENT } from './types.ts';
import { getNetworkIndex, incomingSegLine, outgoingSegLine, playerGroupOf } from './networkIndex.ts';

/**
 * 出題。origin / destination は「表示される駅」の駅レコード index。
 * 端点は乗換グループ単位で、同じグループのどの駅レコードから乗って・で降りてもよい
 * （例: 到着が永田町なら赤坂見附で降りてもよい）。出題時に選ぶレコードは表示用で、端点集合には影響しない。
 */
export interface Question {
  origin: number;
  destination: number;
  minTransfers: number;
}

export interface QuestionOptions {
  minTransfers?: number;
  maxTransfers?: number;
  rng?: () => number;
}

const MAX_ATTEMPTS = 200;

/**
 * 出発駅から到着駅までの最小乗換回数を、パターン（有向）単位のラウンド探索で求める。
 * 端点は searchRoute と同じくグループ単位: 最初の乗車は出発グループの任意の駅レコードから、
 * 到着は到着グループの任意の駅レコードに着いたとき。
 * ラウンドk = 乗車k回目。乗れるパターン（乗車位置以降の停車駅が到達範囲）を乗り、到達した
 * グループから次のラウンドで別のパターンに乗る。到着駅に着いたラウンド - 1 が乗換回数。
 * 直通運転（同一パターンで路線をまたぐ）は乗換に数えないため、searchRoute の 'transfers' モードの
 * 乗換回数と一致する。到達不可能な場合は null。
 */
function minTransfersBetweenStations(
  network: Network,
  origin: number,
  destination: number
): number | null {
  const originGroup = network.stations[origin].group;
  if (originGroup === network.stations[destination].group) return 0;

  const index = getNetworkIndex(network);
  const destGroup = network.stations[destination].group;
  const P = network.patterns.length;
  // パターンごとに「これまでに乗車した最小の位置」を覚え、より手前から乗れる場合だけ再走査する
  const boardedFrom = new Int32Array(P).fill(0x7fffffff);
  // 到達済みグループ。出発グループへ戻っての乗換は考えない（searchRoute と同じ）
  const reached = new Set<number>([originGroup]);
  let frontier: number[][] = [index.groupMembers.get(originGroup) ?? [origin]];

  for (let round = 1; frontier.length > 0; round++) {
    const toScan = new Map<number, number>(); // pattern -> 最小の乗車位置
    for (const members of frontier) {
      for (const s of members) {
        for (let k = index.stationNodeStart[s]; k < index.stationNodeStart[s + 1]; k++) {
          const node = index.stationNodeList[k];
          // ラウンド1（出発グループのレコード）は、直通リンクから始まる乗車を端点にしない（searchRoute と同じ）
          if (round === 1 && outgoingSegLine(network, index, node) === LINK_SEGMENT) continue;
          const p = index.nodePattern[node];
          const pos = index.nodePos[node];
          if (pos < boardedFrom[p] && pos < (toScan.get(p) ?? Number.POSITIVE_INFINITY)) {
            toScan.set(p, pos);
          }
        }
      }
    }
    const next: number[][] = [];
    for (const [p, pos] of toScan) {
      boardedFrom[p] = pos;
      const start = index.patOffset[p];
      const end = index.patOffset[p + 1];
      // 環状パターンは全停車駅に到達でき、それ以外は乗車位置より後ろの停車駅に到達できる
      const from = index.isRing[p] ? start : start + pos;
      for (let node = from; node < end; node++) {
        // 乗車駅そのものは降車ではない。直通リンクで着いたレコードも降車駅にできない。
        // （到着グループのレコードから乗ることはないので、環状を一周して戻る乗車は考えなくてよい）
        const boardingNode = node === start + pos;
        if (
          !boardingNode &&
          network.stations[index.nodeStation[node]].group === destGroup &&
          incomingSegLine(network, index, node) !== LINK_SEGMENT
        ) {
          return round - 1;
        }
        const g = network.stations[index.nodeStation[node]].group;
        if (!reached.has(g)) {
          reached.add(g);
          next.push(index.groupMembers.get(g) ?? []);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * エリア内の駅集合から、指定条件を満たす2駅を選び出題を生成する。
 * 同一乗換グループの駅同士は不可。最小乗換回数は路線グラフのBFSで求める。
 * 条件（デフォルト: minTransfers>=1）を満たす組み合わせが見つからなければ null。
 */
export function generateQuestion(
  network: Network,
  areaStations: number[],
  opts: QuestionOptions = {}
): Question | null {
  const minTransfers = opts.minTransfers ?? 1;
  const maxTransfers = opts.maxTransfers;
  const rng = opts.rng ?? Math.random;

  // 出題除外（noQuestion）の乗換グループの駅は出発駅・到着駅にしない
  areaStations = areaStations.filter((s) => !network.stations[s].noQuestion);
  if (areaStations.length < 2) return null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const originIdx = Math.floor(rng() * areaStations.length);
    let destIdx = Math.floor(rng() * (areaStations.length - 1));
    if (destIdx >= originIdx) destIdx++;

    const origin = areaStations[originIdx];
    const destination = areaStations[destIdx];

    const originGroup = network.stations[origin].group;
    const destGroup = network.stations[destination].group;
    if (originGroup === destGroup) continue;
    // プレイヤーが同じ乗換駅として扱える駅同士（東京→大手町など）は出題しない
    if (playerGroupOf(network, origin) === playerGroupOf(network, destination)) continue;

    const result = minTransfersBetweenStations(network, origin, destination);
    if (result === null) continue;
    if (result < minTransfers) continue;
    if (maxTransfers !== undefined && result > maxTransfers) continue;

    return { origin, destination, minTransfers: result };
  }

  return null;
}
