import type { AnswerMode, Itinerary, Network, RouteEvaluation, RouteLeg } from './types.ts';
import { getNetworkIndex, playerGroupOf } from './networkIndex.ts';
import { evaluateRoute, ridableStationsOnLine } from './validate.ts';
import type { AutocompleteOption } from './autocomplete.ts';
import { normalizeRomaji } from './romaji.ts';
import { companySearchTerms } from './companyReadings.ts';

/** difficulty -> generateQuestion の乗換回数レンジ */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'かんたん（乗換1回）',
  normal: 'ふつう（乗換1〜2回）',
  hard: 'むずかしい（乗換2回以上）',
};

export function difficultyToTransferRange(difficulty: Difficulty): {
  minTransfers: number;
  maxTransfers?: number;
} {
  switch (difficulty) {
    case 'easy':
      return { minTransfers: 1, maxTransfers: 1 };
    case 'normal':
      return { minTransfers: 1, maxTransfers: 2 };
    case 'hard':
      return { minTransfers: 2 };
  }
}

/** 秒数を "X分" もしくは "X時間Y分" 形式に整形する */
export function formatDuration(sec: number): string {
  const totalMinutes = Math.round(sec / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) {
    return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  }
  return `${m}分`;
}

/**
 * 所要秒を "約X分" もしくは "約X時間Y分" 形式に整形する。
 * 時刻表の最速の運用の所要時間の合計＋乗換ペナルティ（固定）に基づく目安であるため「約」を付ける。
 */
export function formatEstimatedDuration(sec: number): string {
  return `約${formatDuration(sec)}`;
}

/** 駅のグループ代表名（グループ内先頭に見つかった駅の name）を返す */
export function stationDisplayName(network: Network, stationIdx: number): string {
  const station = network.stations[stationIdx];
  if (!station) return '(不明な駅)';
  return station.name;
}

/** グループ番号から、そのグループに属する駅の代表名を返す（グループ内最初の駅のname） */
export function groupDisplayName(network: Network, group: number): string {
  const station = network.stations.find((s) => s.group === group);
  return station ? station.name : '(不明な駅)';
}

/** 路線名を "路線名（事業者名）" の形式に整形する（例: 銀座線（東京メトロ）） */
export function formatLineName(network: Network, lineIdx: number): string {
  const line = network.lines[lineIdx];
  if (!line) return '不明な路線';
  return `${line.name}（${line.company}）`;
}

/**
 * 路線オートコンプリートの候補一覧（全路線）を構築する。
 * label は「路線名（事業者名）」。searchText は日本語名、romaji は英語表記の正規化キー
 * （かな・ローマ字入力でもヒットする）。badge は LineBadge 表示用。
 * 事業者名検索のため、事業者の略称（searchText）と読み・英字通称（romaji）も検索対象に足す。
 * romaji は「路線の英語表記|事業者の読み1|事業者の読み2…」の形式で、路線自身の名前が
 * 先頭に来るため、路線名の前方一致が事業者名のみのヒットより優先される。
 */
export function buildLineOptions(network: Network): AutocompleteOption[] {
  return network.lines.map((line, lineIdx) => {
    const label = formatLineName(network, lineIdx);
    const company = companySearchTerms(line.company);
    return {
      id: lineIdx,
      label,
      searchText: company.text ? `${label} ${company.text}` : label,
      romaji: [normalizeRomaji(line.en), ...company.romaji].join('|'),
      badge: { name: line.name, company: line.company, color: line.color },
    };
  });
}

/**
 * 降車駅オートコンプリートの候補一覧を構築する（グループ＝物理駅 × 駅名 の単位で重複排除）。
 * - id はその（グループ, 駅名）の代表駅（stations 配列で最初に出現する駅index）
 *   （同じグループ内でも駅名が異なる場合は別候補。例: 新宿 / 新宿西口 / 都庁前 が同一グループのとき）
 * - searchText は日本語駅名、romaji は英語表記の正規化キー
 * - 同じ駅名が複数のグループに存在する場合（例: 別の場所にある同名の浅草）に限り、
 *   note に乗り入れ路線（最初の1路線＋「ほか」）を添えて区別できるようにする
 */
export function buildStationOptions(network: Network): AutocompleteOption[] {
  const seen = new Set<string>();
  const reps: { stationIdx: number; name: string; en: string; group: number }[] = [];
  const groupCountByName = new Map<string, Set<number>>();
  const groupLines = new Map<number, number[]>();

  network.stations.forEach((station, stationIdx) => {
    const lines = groupLines.get(station.group);
    if (lines) {
      if (!lines.includes(station.line)) lines.push(station.line);
    } else {
      groupLines.set(station.group, [station.line]);
    }
    const key = `${station.group}\u0000${station.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    reps.push({ stationIdx, name: station.name, en: station.en, group: station.group });
    const groups = groupCountByName.get(station.name);
    if (groups) groups.add(station.group);
    else groupCountByName.set(station.name, new Set([station.group]));
  });

  return reps.map((rep) => {
    const option: AutocompleteOption = {
      id: rep.stationIdx,
      label: rep.name,
      searchText: rep.name,
      romaji: normalizeRomaji(rep.en),
    };
    if ((groupCountByName.get(rep.name)?.size ?? 0) >= 2) {
      const lines = groupLines.get(rep.group) ?? [];
      if (lines.length > 0) {
        option.note = formatLineName(network, lines[0]) + (lines.length > 1 ? 'ほか' : '');
      }
    }
    return option;
  });
}

/**
 * 降車駅候補（buildStationOptions）に、「選んだ路線に現在駅で乗ってそのまま直通先で着ける駅」の印を付ける。
 * 該当する駅の候補は id を直通先の路線上の駅レコードにし、note に「（直通先の路線名）直通」を足す
 * （例: 半蔵門線を永田町で選んだとき、三軒茶屋に「田園都市線直通」）。
 * 選んだ路線自身の駅（同グループ・同駅名のレコードが路線上にある）は対象外。方向は有向で考える。
 */
export function markThroughStationOptions(
  network: Network,
  options: AutocompleteOption[],
  lineIdx: number,
  currentStation: number
): AutocompleteOption[] {
  const from = stationOnLineInGroup(network, lineIdx, currentStation);
  if (from === null) return options;
  const key = (s: number) => `${network.stations[s].group}\u0000${network.stations[s].name}`;
  const ownKeys = new Set<string>();
  for (const s of getNetworkIndex(network).lineStations[lineIdx]) ownKeys.add(key(s));
  const through = new Map<string, number[]>();
  for (const s of ridableStationsOnLine(network, lineIdx, from)) {
    if (network.stations[s].line === lineIdx || ownKeys.has(key(s))) continue;
    const arr = through.get(key(s));
    if (arr) arr.push(s);
    else through.set(key(s), [s]);
  }
  if (through.size === 0) return options;
  return options.map((option) => {
    const recs = through.get(key(option.id));
    if (!recs) return option;
    const names = [...new Set(recs.map((r) => network.lines[network.stations[r].line].name))];
    const label = names.map((n) => `${n}直通`).join('・');
    return { ...option, id: recs[0], note: option.note ? `${option.note} ${label}` : label };
  });
}

/** 指定駅（グループ）を通る路線のインデックス一覧を重複なく返す */
export function linesThroughStation(network: Network, stationIdx: number): number[] {
  if (!network.stations[stationIdx]) return [];
  // 「使ってもいい」乗換駅（東京⇔大手町）の路線も含める（プレイヤー用グループ）
  const members = getNetworkIndex(network).playerGroupMembers.get(playerGroupOf(network, stationIdx)) ?? [];
  const result: number[] = [];
  for (const m of members) {
    const line = network.stations[m].line;
    if (!result.includes(line)) result.push(line);
  }
  return result;
}

/**
 * 指定路線に含まれる駅（グループ代表で重複排除）の一覧を、
 * excludeGroup（現在駅のグループ）を除いて返す。
 * 戻り値は { stationIdx, name } のリストで、stationIdx は路線上で最初に見つかった駅のindex。
 */
export function stationsOnLine(
  network: Network,
  lineIdx: number,
  excludeGroup?: number
): { stationIdx: number; name: string; group: number }[] {
  const line = network.lines[lineIdx];
  if (!line) return [];

  const seenGroups = new Set<number>();
  const result: { stationIdx: number; name: string; group: number }[] = [];
  for (const stationIdx of getNetworkIndex(network).lineStations[lineIdx]) {
    const station = network.stations[stationIdx];
    if (excludeGroup !== undefined && station.group === excludeGroup) continue;
    if (seenGroups.has(station.group)) continue;
    seenGroups.add(station.group);
    result.push({ stationIdx, name: station.name, group: station.group });
  }
  return result;
}

/**
 * 指定駅と同一グループの駅のうち、指定路線の駅レコードである駅 index を返す。見つからなければ null。
 * 同じグループ・同じ路線に複数レコードがあるとき（例: 大江戸線の 新宿 と 新宿西口）は、
 * 指定駅と同じ駅名のレコードを優先する（出発・到着の端点は駅名で決まるため）。
 *
 * Station は路線ごとに別レコードのため（例: 東京(山手線) と 東京(丸ノ内線) は
 * 同一グループだが別 index）、直前の路線で降りた駅 index をそのまま次の路線の
 * leg.from に使うと validateRoute が 'station-not-on-line' で落ちる。
 * leg 生成時にこのヘルパーで路線上の駅 index へマップして吸収する。
 */
export function stationOnLineInGroup(
  network: Network,
  lineIdx: number,
  stationIdx: number
): number | null {
  const line = network.lines[lineIdx];
  const station = network.stations[stationIdx];
  if (!line || !station) return null;

  // プレイヤー用グループ（東京で降りた後に大手町の路線へ乗る、など）で探す
  const members = getNetworkIndex(network).playerGroupMembers.get(playerGroupOf(network, stationIdx)) ?? [stationIdx];
  let fallback: number | null = null;
  for (const m of members) {
    if (network.stations[m].line !== lineIdx) continue;
    if (network.stations[m].name === station.name) return m;
    fallback ??= m;
  }
  return fallback;
}

/**
 * 経路組立UIの leg 生成用ヘルパー。
 * from（現在駅）・to（降車駅）をそれぞれ選択路線上の駅 index にマップした
 * RouteLeg を返す。
 *
 * - from（現在駅）: 同名レコードを優先し、無ければ同グループの別名レコードに乗り換える
 *   （例: 金町(常磐線)で降りて 京成金町(京成線) に乗る）。
 * - to（降車駅）: プレイヤーが入力した駅名のレコードだけを使う。選択路線にその駅名の
 *   レコードが無ければ別名のレコードへ黙ってすり替えず、元の index のまま返す
 *   （回答時に validateRoute が 'station-not-on-line' で不正解にする。例: 常磐線に「京成金町」）。
 *
 * 路線・降車駅は全候補から自由入力で選べるため、選択路線上に存在しない駅が渡されうる。
 * 即時エラーにはせず、回答時に validateRoute が理由付きで不正解と判定する
 * （プレイヤーが路線名・駅名を自力で思い出すゲーム性のため、入力時点では正誤を明かさない）。
 */
export function buildLeg(
  network: Network,
  lineIdx: number,
  fromStation: number,
  toStation: number
): RouteLeg {
  const from = stationOnLineInGroup(network, lineIdx, fromStation) ?? fromStation;
  const toName = network.stations[toStation]?.name;
  const mappedTo = stationOnLineInGroup(network, lineIdx, toStation);
  if (mappedTo !== null && network.stations[mappedTo].name === toName) {
    return { line: lineIdx, from, to: mappedTo };
  }
  // 選択路線の駅でなくても、その路線に乗ってそのまま直通先に着く駅（同グループ・同駅名のレコード）なら
  // 直通先の路線上のレコードを使う（例: 半蔵門線 永田町→三軒茶屋）
  const ridable = ridableStationsOnLine(network, lineIdx, from);
  const sameNameInGroup = (getNetworkIndex(network).groupMembers.get(network.stations[toStation]?.group) ?? []).filter(
    (s) => network.stations[s].name === toName
  );
  const throughTo = [toStation, ...sameNameInGroup].find((s) => ridable.includes(s));
  return { line: lineIdx, from, to: throughTo ?? toStation };
}

/** インクリメンタル絞り込み: クエリ文字列を含む駅名のみを残す（大小文字区別なし、簡易） */
export function filterStationsByQuery<T extends { name: string }>(
  stations: T[],
  query: string
): T[] {
  const q = query.trim();
  if (q === '') return stations;
  return stations.filter((s) => s.name.includes(q));
}

/** 日本語の判定理由メッセージを生成する */
export function reasonMessage(
  network: Network,
  legs: RouteLeg[],
  reason: string | undefined,
  legIndex: number | undefined,
  endpoints?: { origin: number; destination: number }
): string {
  if (reason === undefined) return '';
  const leg = legIndex !== undefined ? legs[legIndex] : undefined;
  const lineName = leg ? formatLineName(network, leg.line) : '不明な路線';
  const fromName = leg ? stationDisplayName(network, leg.from) : '';
  const toName = leg ? stationDisplayName(network, leg.to) : '';

  switch (reason) {
    case 'empty':
      return '経路が組み立てられていません。乗車区間を追加してください。';
    case 'wrong-origin':
      return endpoints
        ? `最初の乗車駅「${fromName}」は出発駅「${stationDisplayName(network, endpoints.origin)}」（と同じ乗換駅）ではありません。`
        : `最初の乗車駅「${fromName}」が出発駅と異なります。`;
    case 'wrong-destination':
      return endpoints
        ? `最後の降車駅「${toName}」は到着駅「${stationDisplayName(network, endpoints.destination)}」（と同じ乗換駅）ではありません。`
        : `最後の降車駅「${toName}」が到着駅と異なります。`;
    case 'station-not-on-line':
      return `「${fromName}」または「${toName}」は${lineName}の駅ではありません。`;
    case 'not-connected-on-line':
      return `${lineName}では「${fromName}」から「${toName}」へ移動できません。`;
    case 'bad-transfer':
      return `乗換区間${legIndex !== undefined ? legIndex + 1 : ''}で乗換元と乗車駅が一致していません。`;
    case 'degenerate-leg':
      return `乗車区間${legIndex !== undefined ? legIndex + 1 : ''}の乗車駅と降車駅が同じです。`;
    default:
      return '経路が不正です。';
  }
}

export type JudgementLevel = 'perfect' | 'close' | 'miss' | 'invalid';

export interface Judgement {
  level: JudgementLevel;
  message: string;
}

/**
 * ユーザーの解答評価（evaluateRoute の結果）と模範解答（Itinerary、無ければ null）を
 * 選択中の AnswerMode の指標で比較し、3段階（perfect / close / miss）で判定する。
 * 「正解」はパーフェクト（模範解答と同等以下）のみ。それ以外は超過の度合いに応じて
 * 「おしい！」（close）か「不正解…」（miss）になる。
 *
 * - mode='time'（ratio = evaluation.totalSec / reference.totalSec）:
 *   ratio <= 1.0 -> perfect、ratio <= 1.1 -> close、ratio > 1.1 -> miss。
 *   totalSec が算出不能（null）なら miss。
 * - mode='transfers'（diff = evaluation.transfers - reference.transfers）:
 *   diff <= 0 -> perfect、diff === 1 -> close、diff >= 2 -> miss。
 *
 * 模範解答が見つからない（reference === null）場合は比較のしようがないため perfect 扱い。
 * 経路自体が無効な場合（invalid）はこの関数を通らず reasonMessage で理由を表示する。
 */
export function judgeAnswer(
  mode: AnswerMode,
  evaluation: RouteEvaluation,
  reference: Itinerary | null
): Judgement {
  if (reference === null) {
    // 模範解答が無い（探索不能）場合は比較のしようがないため正解扱いとする
    return { level: 'perfect', message: '模範解答が見つからなかったため正解扱いです' };
  }

  if (mode === 'transfers') {
    const refTransfers = reference.transfers;
    const diff = evaluation.transfers - refTransfers;
    if (diff <= 0) {
      return {
        level: 'perfect',
        message: `パーフェクト！最少の乗換回数です（乗換${refTransfers}回）`,
      };
    }
    if (diff === 1) {
      return {
        level: 'close',
        message: `おしい！模範解答より乗換1回多い経路です（模範解答: 乗換${refTransfers}回）`,
      };
    }
    return { level: 'miss', message: `不正解… 模範解答は乗換${refTransfers}回でした` };
  }

  // mode === 'time'
  const refDuration = formatEstimatedDuration(reference.totalSec);
  if (evaluation.totalSec === null) {
    return {
      level: 'miss',
      message: `所要時間を算出できませんでした（模範解答: ${refDuration}）`,
    };
  }
  const ratio = evaluation.totalSec / reference.totalSec;
  if (ratio <= 1.0) {
    return {
      level: 'perfect',
      message: `パーフェクト！模範解答と同じ所要時間です（${refDuration}）`,
    };
  }
  // 超過率（%）。四捨五入で0%になる僅かな超過も「おしい」と表現できるよう最低1%とする
  const percent = Math.max(1, Math.round((ratio - 1) * 100));
  if (ratio <= 1.1) {
    return {
      level: 'close',
      message: `おしい！模範解答より約${percent}%長い経路です（模範解答: ${refDuration}）`,
    };
  }
  return {
    level: 'miss',
    message: `不正解… 模範解答より約${percent}%長い経路です（模範解答: ${refDuration}）`,
  };
}

/** 表示用の区間。通し運転で路線名が同じ区間（事業者違いを含む）を1つにまとめたもの。 */
export interface DisplayLeg {
  /** 先頭の区間の路線（line index）。 */
  line: number;
  /** まとめた区間の路線名（重複なし・順序保持）。単独なら "路線名（事業者名）"、複数事業者なら "路線名（A・B）"。 */
  label: string;
  from: number;
  to: number;
  /** 最後にまとめた区間の路線（直通先の注記判定用）。 */
  lastLine: number;
  through?: boolean;
  /** 乗車秒の合計（入力に rideSec があるときのみ）。 */
  rideSec?: number;
}

/**
 * 連続する区間のうち、直通（through=true）でつながり、路線名が等しいもの（事業者が違ってもよい。
 * 例: 東海道線 JR東日本 ＝直通＝ 東海道線 JR東海）を1区間にまとめる。実際の乗換をはさむ区間はまとめない。
 */
export function mergeThroughLegsByName(
  network: Network,
  legs: (RouteLeg & { through?: boolean; rideSec?: number })[]
): DisplayLeg[] {
  const out: DisplayLeg[] = [];
  const companies: string[][] = [];
  for (const leg of legs) {
    const line = network.lines[leg.line];
    const prev = out[out.length - 1];
    if (prev && leg.through && line && network.lines[prev.lastLine]?.name === line.name) {
      prev.to = leg.to;
      prev.lastLine = leg.line;
      if (leg.rideSec !== undefined) prev.rideSec = (prev.rideSec ?? 0) + leg.rideSec;
      const cs = companies[companies.length - 1];
      if (!cs.includes(line.company)) cs.push(line.company);
      continue;
    }
    out.push({ line: leg.line, label: '', from: leg.from, to: leg.to, lastLine: leg.line, through: leg.through, rideSec: leg.rideSec });
    companies.push(line ? [line.company] : []);
  }
  out.forEach((d, i) => {
    const line = network.lines[d.line];
    d.label = line ? `${line.name}（${companies[i].join('・')}）` : '不明な路線';
  });
  return out;
}

/**
 * 経路を表示用文字列に変換する
 * （例: "山手線（JR東日本） 東京→上野 ｜ 丸ノ内線（東京メトロ） 上野→新宿"）。
 * 直通運転（through 付きの区間）は「｜」ではなく「直通」でつなぐ。
 * 直通で路線名が同じ区間は1区間にまとめる（mergeThroughLegsByName）。
 */
export function formatRouteLegs(network: Network, legs: (RouteLeg & { through?: boolean })[]): string {
  if (legs.length === 0) return '（まだ経路がありません）';
  let out = '';
  mergeThroughLegsByName(network, legs).forEach((leg, i) => {
    const fromName = stationDisplayName(network, leg.from);
    const toName = stationDisplayName(network, leg.to);
    if (i > 0) out += leg.through ? ' ＝直通＝ ' : ' ｜ ';
    // 降車駅が別路線の駅（直通先まで乗り続けた区間）なら、直通先の路線名を添える
    const toLine = network.stations[leg.to]?.line;
    const throughNote =
      toLine !== undefined && toLine !== leg.lastLine && network.lines[toLine]
        ? `（${network.lines[toLine].name}直通）`
        : '';
    out += `${leg.label}${throughNote} ${fromName}→${toName}`;
  });
  return out;
}

/**
 * プレイヤーの経路（through を持たない RouteLeg 列）に、直通（乗換なしでつながる）かどうかを付与する。
 * 区間 i の先頭までの最小乗換回数が、区間 i-1 までと同じなら、境目は直通。
 */
export function annotateThrough(network: Network, legs: RouteLeg[]): (RouteLeg & { through?: boolean })[] {
  const transfers: number[] = [];
  for (let i = 0; i < legs.length; i++) {
    const ev = evaluateRoute(network, legs.slice(0, i + 1), 'transfers');
    transfers.push(ev.totalSec === null ? Number.NaN : ev.transfers);
  }
  return legs.map((leg, i) => (i > 0 && transfers[i] === transfers[i - 1] ? { ...leg, through: true } : { ...leg }));
}

/** プレイヤーの経路を表示用文字列に変換する（直通を判定してから formatRouteLegs）。 */
export function formatPlayerRouteLegs(network: Network, legs: RouteLeg[]): string {
  return formatRouteLegs(network, annotateThrough(network, legs));
}

/** Itinerary（模範解答）を表示用文字列に変換する */
export function formatItinerary(network: Network, itinerary: Itinerary): string {
  return formatRouteLegs(network, itinerary.legs);
}
