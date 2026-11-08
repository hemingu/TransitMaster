/**
 * 実データ検証用 CLI。public/data/network.json を読み込み、指定した2駅間の経路を
 * searchRoute（src/lib/raptor.ts）で実際に探索し、結果を人間が読める形式で出力する。
 *
 * 使い方:
 *   npm run route -- <出発駅名> <到着駅名> [time|transfers]
 *
 * モード（time/transfers）を省略した場合は両方のモードで探索して出力する。
 * 駅名は NFKC 正規化した上で完全一致検索する。同名の駅が複数の駅グループに
 * 存在する場合（例: 別の場所にある同名の「浅草」等）は、どのグループを
 * 指しているか一意に決まらないため、候補一覧を表示して終了する
 * （どの駅indexを探索起点に使うかはグループ内で任意の1つでよいため、
 * 候補が1グループに絞れた時点でそのグループの先頭駅を使う）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { searchRoute } from '../src/lib/raptor.ts';
import { linesThroughStation, formatLineName, mergeThroughLegsByName, formatEstimatedDuration, stationDisplayName } from '../src/lib/game.ts';
import type { AnswerMode, Network } from '../src/lib/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NETWORK_PATH = resolve(ROOT, 'public', 'data', 'network.json');

/** NFKC正規化した上で完全一致比較するための正規化関数。 */
function normalize(name: string): string {
  return name.normalize('NFKC').trim();
}

function loadNetwork(): Network {
  if (!existsSync(NETWORK_PATH)) {
    console.error(
      `public/data/network.json が見つかりません（${NETWORK_PATH}）。\n` +
        'npm run build:network（実データ）または npm run build:network -- --fixture（ミニデータ）を先に実行してください。'
    );
    process.exit(1);
  }
  const raw = readFileSync(NETWORK_PATH, 'utf-8');
  return JSON.parse(raw) as Network;
}

/**
 * 駅名（正規化済み）に完全一致する駅を全件探し、グループ単位でまとめる。
 * 戻り値はグループID一覧（同じグループに属する駅は複数レコードあっても1つにまとめる）。
 */
function findGroupsByName(network: Network, normalizedName: string): number[] {
  const groups = new Set<number>();
  for (const station of network.stations) {
    if (normalize(station.name) === normalizedName) {
      groups.add(station.group);
    }
  }
  return [...groups];
}

/** グループの代表駅index（先頭に見つかった駅）を返す。 */
function representativeStation(network: Network, group: number): number {
  const idx = network.stations.findIndex((s) => s.group === group);
  if (idx === -1) {
    throw new Error(`グループ ${group} に属する駅が見つかりません（内部エラー）。`);
  }
  return idx;
}

/** グループが乗り入れている路線名（formatLineName形式）の一覧を返す（重複なし）。 */
function lineNamesForGroup(network: Network, group: number): string[] {
  const stationIdx = representativeStation(network, group);
  const lineIdxs = linesThroughStation(network, stationIdx);
  return lineIdxs.map((lineIdx) => formatLineName(network, lineIdx));
}

/**
 * 駅名を検索し、一意に決まる駅index（探索起点として使う代表駅）を返す。
 * 見つからない場合、または複数グループに分かれて一意に決まらない場合はエラー終了する。
 */
function resolveStation(network: Network, label: string, rawName: string): number {
  const normalized = normalize(rawName);
  const groups = findGroupsByName(network, normalized);

  if (groups.length === 0) {
    console.error(`${label}駅「${rawName}」が見つかりませんでした。駅名の表記を確認してください。`);
    process.exit(1);
  }

  if (groups.length > 1) {
    console.error(`${label}駅「${rawName}」に該当する駅が複数のグループに存在するため一意に決まりません。`);
    console.error('候補:');
    for (const group of groups) {
      const lines = lineNamesForGroup(network, group);
      console.error(`  ${rawName}（${lines.join(', ')}）`);
    }
    process.exit(1);
  }

  // 端点は「グループ＋入力した駅名」で決まる（searchRoute 側で同名レコードに展開される）ので、
  // グループの先頭ではなく入力名と一致するレコードを起点にする。
  const idx = network.stations.findIndex(
    (s) => s.group === groups[0] && normalize(s.name) === normalized
  );
  return idx;
}

/** 1つのモードで探索を実行し、結果を出力する。 */
function runAndPrint(network: Network, from: number, to: number, mode: AnswerMode): void {
  const modeLabel = mode === 'time' ? '最短時間' : '最小乗換';
  const timerLabel = `探索時間（${modeLabel}）`;

  console.log(`\n--- モード: ${modeLabel} ---`);
  console.time(timerLabel);
  const itinerary = searchRoute(network, from, to, mode);
  console.timeEnd(timerLabel);

  if (itinerary === null) {
    console.log('経路が見つかりませんでした。');
    return;
  }

  console.log('経路:');
  for (const leg of mergeThroughLegsByName(network, itinerary.legs)) {
    const fromName = stationDisplayName(network, leg.from);
    const toName = stationDisplayName(network, leg.to);
    console.log(`  ${leg.through ? '＝直通＝ ' : ''}${leg.label} ${fromName}→${toName}（${Math.round((leg.rideSec ?? 0) / 60)}分）`);
  }
  console.log(`乗換回数: ${itinerary.transfers}`);
  console.log(
    `所要時間: ${formatEstimatedDuration(itinerary.totalSec)}（乗車 ${(itinerary.rideSec / 60).toFixed(1)}分 + 乗換 ${itinerary.transfers}回×${network.transferSec / 60}分）`
  );
}

function printUsageAndExit(): void {
  console.error('使い方: npm run route -- <出発駅名> <到着駅名> [time|transfers]');
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsageAndExit();
  }

  const [fromName, toName, modeArg] = args;

  let modes: AnswerMode[];
  if (modeArg === undefined) {
    modes = ['time', 'transfers'];
  } else if (modeArg === 'time' || modeArg === 'transfers') {
    modes = [modeArg];
  } else {
    console.error(`不明なモード「${modeArg}」です。time または transfers を指定してください。`);
    process.exit(1);
    return;
  }

  const network = loadNetwork();
  const from = resolveStation(network, '出発', fromName);
  const to = resolveStation(network, '到着', toName);

  console.log(`${fromName} → ${toName} の経路を探索します。`);
  for (const mode of modes) {
    runAndPrint(network, from, to, mode);
  }
}

main();
