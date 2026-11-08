/**
 * Mini Tokyo 3D (MT3D) のデータから Network (v3) を構築する純粋関数群。
 * ファイルI/Oは build-mt3d-network.ts 側が担当し、ここは入力オブジェクト -> Network の変換のみ。
 *
 * 処理の流れ:
 *  1. 有料列車（有料特急・座席指定ライナー等）を除外し、駅レコード・路線を絞り込む
 *  2. 列車を nt（次列車）で連結して「運用(run)」にする（直通運転・分割併合も追従）
 *  3. 同じ（駅, 区間の路線）列の運用を1つのパターンにまとめ、合計所要が最小の運用の時間を採用（最速基準）
 *  4. 他のパターンの連続部分列で、かつ時間が同等以下のパターンを刈り込む
 *  5. 環状線（山手線）は最速の1周列車から方向ごとに環状パターンを作る
 *  6. 乗換グループ（station-groups.json + alternate）を作り、サービスのない駅・路線を落とす
 */
import { LINK_SEGMENT } from '../src/lib/types.ts';
import type { Line, Network, Pattern, Station } from '../src/lib/types.ts';
import { matchRidership, type S12Station } from './s12Ridership.ts';

// ---------------------------------------------------------------------------
// 入力（MT3D 形式）
// ---------------------------------------------------------------------------

/**
 * 乗換グループの手動調整。グループは「駅名の集合」で特定する（listed な名前をすべて含むグループ）。
 * 該当が0件または複数件、split で名前の挙げ漏れがある場合はビルドを失敗させる。
 */
export interface TransferGroupOverrides {
  /** 該当グループ内で、挙げた駅名ごとに別グループへ分割する。 */
  split?: string[][];
  /** 2つのグループ（それぞれ駅名リストで特定）を1つに統合する。 */
  merge?: [string[], string[]][];
  /** 該当グループ内の全駅を出題の出発駅・到着駅にしない（noQuestion）。 */
  exclude?: string[][];
  /**
   * 駅名単位の出題除外。この駅名の駅レコードだけを出題の出発駅・到着駅にしない（noQuestion）。
   * グループ内の他の駅名は出題に使え、経路の途中の乗換やオートコンプリートでは従来どおり使える
   * （例: モノレール浜松町は外から乗り入れる列車がなく、到着させると往復する経路になるため除外）。
   * 該当する駅が無ければビルドを失敗させる。
   */
  excludeNames?: string[];
  /**
   * 駅名の上書き（MT3D の駅名 -> 採用する駅名）。ビルドの最初に適用するので、グループ化・端点判定・
   * S12 照合はすべて上書き後の名前で行う（例: 押上の表記ゆれ統一）。キーに該当する駅が無ければビルドを失敗させる。
   */
  stationNameOverrides?: Record<string, string>;
  /**
   * 区間の路線の付け替え。railway 上の from〜to（駅名、両端含む。railway の stations 配列上の位置で範囲を決める）の
   * 区間（両方向）を line（MT3D の railway id）の区間に付け替え、駅レコードも line の同名レコードに置き換える。
   * 例: 成田スカイアクセス線の 京成上野〜京成高砂 は物理的には京成本線。
   * 範囲の外の区間に接する駅は、範囲外側のレコードとの間に距離ゼロの直通リンクを挿入してつなぐ。
   * 参照する railway・駅が存在しなければビルドを失敗させる。
   */
  segmentLineOverrides?: SegmentLineOverride[];
}

export interface SegmentLineOverride {
  railway: string;
  from: string;
  to: string;
  line: string;
}

export interface Mt3dTitle {
  ja?: string;
  en?: string;
  [lang: string]: string | undefined;
}

export interface Mt3dRailway {
  id: string;
  title: Mt3dTitle;
  stations: string[];
  color?: string;
}

export interface Mt3dStation {
  id: string;
  railway?: string;
  coord?: [number, number];
  title?: Mt3dTitle;
  alternate?: string;
}

export interface Mt3dTrainType {
  id: string;
  title?: Mt3dTitle;
}

export interface Mt3dTimetableEntry {
  s: string;
  a?: string;
  d?: string;
}

export interface Mt3dTrain {
  id: string;
  r: string;
  y: string;
  d?: string;
  tt: Mt3dTimetableEntry[];
  nt?: string[];
  pt?: string[];
}

export interface Mt3dInput {
  railways: Mt3dRailway[];
  stations: Mt3dStation[];
  /** station-groups.json。各要素 = 乗換駅1か所（駅idの配列の配列）。 */
  stationGroups: string[][][];
  /** 国土数値情報 S12 の解析済み駅別乗降客数（省略可。無ければ ridership なしでビルドする）。 */
  s12?: S12Station[];
  /** data/transfer-group-overrides.json（乗換グループの手動調整。省略可）。 */
  overrides?: TransferGroupOverrides;
  trainTypes: Mt3dTrainType[];
  trains: Mt3dTrain[];
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 同一グループ内の乗換（パターンの乗り換え）ペナルティ秒。 */
export const TRANSFER_SEC = 300;

/**
 * 模範解答から除外する列車種別（乗車券のみでは乗れない列車＝有料特急・座席指定ライナー等）。
 * MT3D の列車種別 id で指定する。
 * なお「特急」という名前でも、京急・京王・東急・相鉄・京成・都営・みなとみらい・北総・芝山の特急や
 * アクセス特急・快速特急・通勤特急・Fライナー（副都心線直通の無料列車）などは追加料金不要なので除外しない。
 */
export const EXCLUDED_TRAIN_TYPES: ReadonlySet<string> = new Set([
  // --- 有料特急（特急券が必要） ---
  'JR-East.LimitedExpress', // 成田エクスプレス・踊り子・あずさ・ひたち 等
  'JR-Central.LimitedExpress', // 特急「ふじさん」等
  'Odakyu.LimitedExpress', // ロマンスカー
  'OdakyuHakone.LimitedExpress', // ロマンスカー（箱根登山線内）
  'TokyoMetro.LimitedExpress', // ロマンスカー（千代田線直通）
  'Tobu.LimitedExpress', // りょうもう・スペーシア・リバティ 等
  'Seibu.LimitedExpress', // ちちぶ・むさし・小江戸
  'Izukyu.LimitedExpress', // 伊豆急 特急（踊り子等）
  'IzuHakone.LimitedExpress', // 伊豆箱根鉄道 特急（踊り子）
  'Fujikyu.LimitedExpress', // 富士急 特急（富士回遊等）
  'Keisei.Skyliner', // スカイライナー
  // --- 座席指定ライナー・座席指定列車（ライナー券・座席指定券が必要） ---
  'JR-East.Liner', // ホームライナー・湘南ライナー等（ライナー券）
  'Keisei.Morningliner', // モーニングライナー
  'Keisei.Eveningliner', // イブニングライナー
  'Keio.KeioLiner', // 京王ライナー
  'Tobu.TJ-Liner', // TJライナー
  'Tobu.TH-LINER', // THライナー
  'TokyoMetro.TH-LINER', // THライナー
  'Seibu.HaijimaLiner', // 拝島ライナー
  'Keikyu.MorningWing', // モーニング・ウィング
  'Keikyu.EveningWing', // イブニング・ウィング
  'Tokyu.S-TRAIN', // S-TRAIN（座席指定）
  'TokyoMetro.S-TRAIN',
  'Seibu.S-TRAIN',
  'Minatomirai.S-TRAIN',
  // --- 有料の急行・観光列車・その他 ---
  'JR-East.Express', // JR 急行（臨時の有料急行）
  'Chichibu.Express', // 秩父鉄道 急行（急行券が必要）
  'Chichibu.PaleoExpress', // パレオエクスプレス（SL）
  'Isumi.Express', // いすみ鉄道 急行（急行券が必要）
  'Tobu.SL-Taiju', // SL大樹
  'Moka.SL-Moka', // SLもおか
  'WataraseKeikoku.Torokko', // トロッコわっしー号
  // --- 鉄道ではない代行輸送 ---
  'Kominato.Bus', // バス代行運転
]);

/** MT3D の id 接頭辞 -> 事業者名（日本語）。 */
export const OPERATOR_NAMES: Readonly<Record<string, string>> = {
  'JR-East': 'JR東日本',
  'JR-Central': 'JR東海',
  TokyoMetro: '東京メトロ',
  TWR: '東京臨海高速鉄道',
  Toei: '都営地下鉄',
  YokohamaMunicipal: '横浜市営地下鉄',
  Keio: '京王電鉄',
  Keikyu: '京急電鉄',
  Keisei: '京成電鉄',
  Hokuso: '北総鉄道',
  Shibayama: '芝山鉄道',
  Tobu: '東武鉄道',
  Seibu: '西武鉄道',
  Odakyu: '小田急電鉄',
  OdakyuHakone: '箱根登山鉄道',
  Tokyu: '東急電鉄',
  Minatomirai: '横浜高速鉄道',
  Sotetsu: '相模鉄道',
  SaitamaRailway: '埼玉高速鉄道',
  MIR: '首都圏新都市鉄道',
  ToyoRapid: '東葉高速鉄道',
  KantoRailway: '関東鉄道',
  Ryutetsu: '流鉄',
  Kominato: '小湊鉄道',
  Isumi: 'いすみ鉄道',
  Choshi: '銚子電気鉄道',
  KashimaRinkai: '鹿島臨海鉄道',
  Hitachinaka: 'ひたちなか海浜鉄道',
  Moka: '真岡鐵道',
  UtsunomiyaLightRail: '宇都宮ライトレール',
  Enoden: '江ノ島電鉄',
  IzuHakone: '伊豆箱根鉄道',
  Izukyu: '伊豆急行',
  Fujikyu: '富士急行',
  Chichibu: '秩父鉄道',
  Jomo: '上毛電気鉄道',
  Joshin: '上信電鉄',
  WataraseKeikoku: 'わたらせ渓谷鐵道',
  Yurikamome: 'ゆりかもめ',
  YokohamaSeaside: '横浜シーサイドライン',
  Yamaman: '山万',
  SaitamaTransit: '埼玉新都市交通',
  TokyoMonorail: '東京モノレール',
  TamaMonorail: '多摩都市モノレール',
  ChibaMonorail: '千葉都市モノレール',
  ShonanMonorail: '湘南モノレール',
};

/** 同名駅を同一グループとみなす距離の上限（メートル）。 */
const NEAR_SAME_NAME_M = 250;

/** 運用(run)として連結する列車数の上限（異常データによる暴走防止）。 */
const MAX_TRAINS_PER_RUN = 8;

const DAY_SEC = 86400;
/** 時刻の巻き戻りがこの値より大きければ日付またぎ（+24h）とみなす。小さければデータのゆらぎとして単調に丸める。 */
const WRAP_THRESHOLD_SEC = 12 * 3600;

// ---------------------------------------------------------------------------
// 補助関数
// ---------------------------------------------------------------------------

/** "HH:MM"（HHは24以上もあり得る）または "HH:MM:SS" を秒に変換する。不正なら NaN。 */
export function parseTime(s: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return Number.NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0);
}

/** 事業者名を id 接頭辞（最初の '.' まで）から得る。未登録なら接頭辞をそのまま返す。 */
export function operatorName(railwayId: string): string {
  const prefix = railwayId.split('.')[0];
  return OPERATOR_NAMES[prefix] ?? prefix;
}

/** Union-Find。 */
class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

// ---------------------------------------------------------------------------
// 列車の前処理
// ---------------------------------------------------------------------------

/** 前処理済みの列車。駅は「入力 stations 配列の添字（record）」、時刻は日またぎ補正済みの絶対秒。 */
interface PTrain {
  id: string;
  /** 路線（入力 railways 配列の添字）。 */
  railway: number;
  /** 停車駅レコード（入力 stations の添字）。 */
  stn: number[];
  /** 到着秒（なければ NaN）。 */
  arr: number[];
  /** 出発秒（なければ NaN）。 */
  dep: number[];
  /** 次列車（前処理後に有効なもののみ）。 */
  next: PTrain[];
  /** 前列車（前処理後に有効なもののみ）。 */
  prev: PTrain[];
}

/** 運用(run)の1ノード。 */
interface RunNode {
  record: number;
  /** パターン累積時間に使う絶対秒（途中駅は出発優先、終着は到着優先）。 */
  time: number;
}

interface Run {
  nodes: RunNode[];
  /** 区間の路線（入力 railways の添字）。直通リンクは LINK_SEGMENT。 */
  segRailway: number[];
}

/** 時刻の前処理: 前の時刻より巻き戻っていたら日またぎとして +24h（小さな巻き戻りは単調に丸める）。 */
function unwrapTimes(entries: Mt3dTimetableEntry[]): { arr: number[]; dep: number[] } | null {
  const arr: number[] = [];
  const dep: number[] = [];
  let prev = -Infinity;
  const fix = (t: number): number => {
    if (Number.isNaN(t)) return Number.NaN;
    let v = t;
    if (prev !== -Infinity && v < prev) {
      if (prev - v > WRAP_THRESHOLD_SEC) {
        while (v < prev - WRAP_THRESHOLD_SEC) v += DAY_SEC;
      }
      if (v < prev) v = prev;
    }
    prev = v;
    return v;
  };
  for (const e of entries) {
    const a = e.a !== undefined ? fix(parseTime(e.a)) : Number.NaN;
    const d = e.d !== undefined ? fix(parseTime(e.d)) : Number.NaN;
    if (Number.isNaN(a) && Number.isNaN(d)) return null;
    arr.push(a);
    dep.push(d);
  }
  return { arr, dep };
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export interface BuildResult {
  network: Network;
  log: string[];
}

/** 作業用パターン（まだ路線・駅の再採番前。stops は入力 stations の添字、segLine は入力 railways の添字）。 */
interface WorkPattern {
  stops: number[];
  segSec: number[];
  segLine: number[];
  total: number;
  ring: boolean;
}

export function buildMt3dNetwork(rawInput: Mt3dInput): BuildResult {
  const log: string[] = [];

  // ---- 0. 駅名の上書き（以降はすべて上書き後の名前で処理する） ----
  const nameOv = rawInput.overrides?.stationNameOverrides ?? {};
  const nameOvHit = new Set<string>();
  const input: Mt3dInput = {
    ...rawInput,
    stations: rawInput.stations.map((st) => {
      const ja = st.title?.ja;
      if (ja !== undefined && Object.hasOwn(nameOv, ja)) {
        nameOvHit.add(ja);
        return { ...st, title: { ...st.title, ja: nameOv[ja] } };
      }
      return st;
    }),
  };
  for (const k of Object.keys(nameOv)) {
    if (!nameOvHit.has(k)) throw new Error(`overrides.stationNameOverrides「${k}」に該当する駅がありません`);
  }
  if (nameOvHit.size > 0) log.push(`駅名の上書き: ${[...nameOvHit].map((k) => `${k}->${nameOv[k]}`).join('、')}`);

  // ---- 1. 路線・駅レコードの索引 ----
  const railwayIndex = new Map<string, number>();
  input.railways.forEach((r, i) => railwayIndex.set(r.id, i));

  const stationIndex = new Map<string, number>();
  const validStation: boolean[] = [];
  input.stations.forEach((s, i) => {
    stationIndex.set(s.id, i);
    validStation.push(
      s.railway !== undefined && railwayIndex.has(s.railway) && Array.isArray(s.coord) && s.title?.ja !== undefined
    );
  });
  const ignoredStations = validStation.filter((v) => !v).length;
  if (ignoredStations > 0) log.push(`路線・座標・駅名のない駅レコード ${ignoredStations} 件を無視しました`);

  // 同名かつ同事業者の路線は1つの路線にまとめる（代表 = 最小の添字の railway）。
  const canonByKey = new Map<string, number>();
  const canon: number[] = input.railways.map((r, i) => {
    const key = `${r.title.ja ?? r.id}|${operatorName(r.id)}`;
    const rep = canonByKey.get(key);
    if (rep !== undefined) return rep;
    canonByKey.set(key, i);
    return i;
  });
  const mergedRailways = input.railways.filter((_, i) => canon[i] !== i);
  if (mergedRailways.length > 0) {
    log.push(`同名・同事業者の路線を統合: ${mergedRailways.map((r) => `${r.id}->${input.railways[canon[railwayIndex.get(r.id)!]].id}`).join('、')}`);
  }

  // 環状路線（stations[0] === stations[last]）
  const ringRailways = new Set<number>();
  input.railways.forEach((r, i) => {
    if (r.stations.length >= 4 && r.stations[0] === r.stations[r.stations.length - 1]) ringRailways.add(i);
  });

  // ---- 2. 列車のフィルタと前処理 ----
  const trainById = new Map<string, PTrain>();
  const excludedByType = new Map<string, number>();
  let droppedInvalid = 0;
  for (const t of input.trains) {
    if (EXCLUDED_TRAIN_TYPES.has(t.y)) {
      excludedByType.set(t.y, (excludedByType.get(t.y) ?? 0) + 1);
      continue;
    }
    const railway = railwayIndex.get(t.r);
    if (railway === undefined || t.tt.length < 2) {
      droppedInvalid++;
      continue;
    }
    const stn: number[] = [];
    let ok = true;
    for (const e of t.tt) {
      const si = stationIndex.get(e.s);
      if (si === undefined || !validStation[si] || input.stations[si].railway !== t.r) {
        ok = false;
        break;
      }
      stn.push(si);
    }
    const times = ok ? unwrapTimes(t.tt) : null;
    if (!ok || !times) {
      droppedInvalid++;
      continue;
    }
    trainById.set(t.id, { id: t.id, railway, stn, arr: times.arr, dep: times.dep, next: [], prev: [] });
  }
  if (droppedInvalid > 0) log.push(`不正な列車（未知の駅・時刻欠落など）${droppedInvalid} 本を除外しました`);
  const excludedTotal = [...excludedByType.values()].reduce((a, b) => a + b, 0);
  log.push(`有料列車として除外: ${excludedTotal} 本（${excludedByType.size} 種別）`);

  for (const t of input.trains) {
    const cur = trainById.get(t.id);
    if (!cur) continue;
    for (const nid of t.nt ?? []) {
      const nx = trainById.get(nid);
      if (!nx) continue;
      // 環状路線の同一路線内連結（一周の続き）は連結しない（環状パターンは別途1周列車から作る）
      if (nx.railway === cur.railway && ringRailways.has(cur.railway)) continue;
      cur.next.push(nx);
      nx.prev.push(cur);
    }
  }

  // ---- 3. 運用(run)の生成 ----
  const ringFull: Map<string, { train: PTrain; total: number }> = new Map(); // 方向 -> 最速の1周列車
  const ringTrainIds = new Set<string>();
  for (const t of input.trains) {
    const cur = trainById.get(t.id);
    if (!cur || !ringRailways.has(cur.railway)) continue;
    const rw = input.railways[cur.railway];
    if (cur.stn.length !== rw.stations.length || cur.stn[0] !== cur.stn[cur.stn.length - 1]) continue;
    const first = Number.isNaN(cur.dep[0]) ? cur.arr[0] : cur.dep[0];
    const lastIdx = cur.stn.length - 1;
    const last = Number.isNaN(cur.arr[lastIdx]) ? cur.dep[lastIdx] : cur.arr[lastIdx];
    const total = last - first;
    const key = `${cur.railway}:${t.d ?? ''}`;
    ringTrainIds.add(cur.id);
    const best = ringFull.get(key);
    if (!best || total < best.total) ringFull.set(key, { train: cur, total });
  }

  const runs: Run[] = [];
  const covered = new Set<string>();
  const startQueue: PTrain[] = [];
  const started = new Set<string>();

  const recordsInChain = new Map<number, number>();
  const chain: PTrain[] = [];

  function addChain(t: PTrain): void {
    chain.push(t);
    for (const r of t.stn) recordsInChain.set(r, (recordsInChain.get(r) ?? 0) + 1);
  }
  function popChain(): void {
    const t = chain.pop()!;
    for (const r of t.stn) {
      const c = recordsInChain.get(r)! - 1;
      if (c === 0) recordsInChain.delete(r);
      else recordsInChain.set(r, c);
    }
  }
  /** next を連結すると既出の駅レコードを再訪してしまうか（継ぎ目の同一レコードは許す）。 */
  function wouldRevisit(next: PTrain): boolean {
    const last = chain[chain.length - 1];
    const junction = last.stn[last.stn.length - 1];
    for (let i = 0; i < next.stn.length; i++) {
      const r = next.stn[i];
      if (i === 0 && r === junction) continue;
      if (recordsInChain.has(r)) return true;
    }
    return false;
  }

  function dfs(): void {
    const cur = chain[chain.length - 1];
    let extended = false;
    let cut = false;
    if (chain.length < MAX_TRAINS_PER_RUN) {
      for (const nx of cur.next) {
        if (chain.includes(nx) || wouldRevisit(nx)) {
          cut = true;
          if (!started.has(nx.id)) {
            started.add(nx.id);
            startQueue.push(nx);
          }
          continue;
        }
        extended = true;
        addChain(nx);
        dfs();
        popChain();
      }
    } else if (cur.next.length > 0) {
      cut = true;
      for (const nx of cur.next) {
        if (!started.has(nx.id)) {
          started.add(nx.id);
          startQueue.push(nx);
        }
      }
    }
    if (!extended || cut) {
      // 先がない、または連結を打ち切った枝がある場合は、ここで終わる運用も1本として登録する
      runs.push(makeRun(chain));
      for (const t of chain) covered.add(t.id);
    }
  }

  function makeRun(trains: PTrain[]): Run {
    const nodes: RunNode[] = [];
    const segRailway: number[] = [];
    let prevTime = -Infinity;
    for (let ti = 0; ti < trains.length; ti++) {
      const t = trains[ti];
      // 列車ごとの時刻（絶対秒）。直前までの時刻より12時間以上前なら日またぎとして+24h
      let shift = 0;
      const firstT = Number.isNaN(t.dep[0]) ? t.arr[0] : t.dep[0];
      if (prevTime !== -Infinity) {
        while (firstT + shift < prevTime - WRAP_THRESHOLD_SEC) shift += DAY_SEC;
      }
      const isLastTrain = ti === trains.length - 1;
      for (let i = 0; i < t.stn.length; i++) {
        const isFinal = isLastTrain && i === t.stn.length - 1;
        const raw = isFinal
          ? Number.isNaN(t.arr[i]) ? t.dep[i] : t.arr[i]
          : Number.isNaN(t.dep[i]) ? t.arr[i] : t.dep[i];
        let time = raw + shift;
        if (time < prevTime) time = prevTime; // 単調に丸める
        prevTime = time;
        if (i === 0 && ti > 0) {
          const lastNode = nodes[nodes.length - 1];
          if (lastNode.record === t.stn[0]) {
            // 同じ駅レコードでの継ぎ目: 1ノードにまとめ、時刻は次列車の出発
            lastNode.time = time;
            continue;
          }
          segRailway.push(LINK_SEGMENT);
          nodes.push({ record: t.stn[0], time });
          continue;
        }
        if (i > 0) segRailway.push(canon[t.railway]);
        nodes.push({ record: t.stn[i], time });
      }
    }
    return { nodes, segRailway };
  }

  function startFrom(t: PTrain): void {
    started.add(t.id);
    addChain(t);
    dfs();
    popChain();
  }

  const allTrains = [...trainById.values()];
  for (const t of allTrains) {
    if (ringTrainIds.has(t.id)) continue;
    if (t.prev.length === 0) startFrom(t);
  }
  // 連結の打ち切りで新たに始点になった列車
  for (let qi = 0; qi < startQueue.length; qi++) {
    const t = startQueue[qi];
    startFrom(t);
  }
  // どの運用にも入らなかった列車（循環のみで始点がない等）の救済
  for (const t of allTrains) {
    if (ringTrainIds.has(t.id)) continue;
    if (!covered.has(t.id)) startFrom(t);
  }
  log.push(`運用(run): ${runs.length} 本（列車 ${allTrains.length} 本）`);

  // ---- 3.5 区間の路線の付け替え（segmentLineOverrides） ----
  applySegmentLineOverrides(input, runs, railwayIndex, canon, log);

  // ---- 4. 同一(駅, 区間路線)列の運用をまとめ、最速の運用を採用 ----
  const bestByKey = new Map<string, WorkPattern>();
  for (const run of runs) {
    const n = run.nodes.length;
    if (n < 2) continue;
    const stops = run.nodes.map((x) => x.record);
    const key = `${stops.join(',')}|${run.segRailway.join(',')}`;
    const total = run.nodes[n - 1].time - run.nodes[0].time;
    const best = bestByKey.get(key);
    if (best && best.total <= total) continue;
    const segSec: number[] = [];
    for (let i = 0; i < n - 1; i++) segSec.push(Math.round(run.nodes[i + 1].time - run.nodes[i].time));
    bestByKey.set(key, { stops, segSec, segLine: run.segRailway.slice(), total, ring: false });
  }

  // ---- 5. 環状パターン（方向ごとに最速の1周列車） ----
  const ringPatterns: WorkPattern[] = [];
  for (const { train } of ringFull.values()) {
    const n = train.stn.length;
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const isFinal = i === n - 1;
      const raw = isFinal
        ? Number.isNaN(train.arr[i]) ? train.dep[i] : train.arr[i]
        : Number.isNaN(train.dep[i]) ? train.arr[i] : train.dep[i];
      times.push(raw);
    }
    const segSec: number[] = [];
    for (let i = 0; i < n - 1; i++) segSec.push(Math.max(0, Math.round(times[i + 1] - times[i])));
    ringPatterns.push({
      stops: train.stn.slice(),
      segSec,
      segLine: new Array<number>(n - 1).fill(canon[train.railway]),
      total: times[n - 1] - times[0],
      ring: true,
    });
  }

  // ---- 6. 刈り込み: 他の（残る）パターンの連続部分列で、かつ時間が同等以下ならば除く ----
  const candidates = [...bestByKey.values()].sort((a, b) => b.stops.length - a.stops.length);
  const retained: WorkPattern[] = [];
  /** 駅レコード -> 残っているパターン内での出現位置。 */
  const posIndex = new Map<number, { pat: WorkPattern; pos: number }[]>();
  const indexPattern = (p: WorkPattern) => {
    const count = p.ring ? p.stops.length - 1 : p.stops.length;
    for (let pos = 0; pos < count; pos++) {
      const arr = posIndex.get(p.stops[pos]);
      if (arr) arr.push({ pat: p, pos });
      else posIndex.set(p.stops[pos], [{ pat: p, pos }]);
    }
  };
  for (const rp of ringPatterns) {
    retained.push(rp);
    indexPattern(rp);
  }

  function containedFaster(p: WorkPattern): boolean {
    const segCount = p.segSec.length;
    const first = posIndex.get(p.stops[0]);
    if (!first) return false;
    for (const { pat: q, pos } of first) {
      const qm = q.ring ? q.stops.length - 1 : q.stops.length;
      if (!q.ring && pos + segCount > q.stops.length - 1) continue;
      if (q.ring && segCount > qm) continue;
      let ok = true;
      let sec = 0;
      for (let i = 0; i < segCount; i++) {
        const qi = q.ring ? (pos + i) % qm : pos + i;
        const qnext = q.ring ? (pos + i + 1) % qm : pos + i + 1;
        if (q.segLine[qi] !== p.segLine[i] || q.stops[qnext] !== p.stops[i + 1]) {
          ok = false;
          break;
        }
        sec += q.segSec[qi];
      }
      if (ok && sec <= p.total) return true;
    }
    return false;
  }

  let pruned = 0;
  for (const p of candidates) {
    if (containedFaster(p)) {
      pruned++;
      continue;
    }
    retained.push(p);
    indexPattern(p);
  }
  log.push(`パターン: ${bestByKey.size + ringPatterns.length} 本 -> 刈り込み後 ${retained.length} 本（刈り込み ${pruned} 本、環状 ${ringPatterns.length} 本）`);

  // ---- 7. 使用する路線・駅の確定と再採番 ----
  const usedRailways = new Set<number>();
  const usedRecords = new Set<number>();
  for (const p of retained) {
    for (const l of p.segLine) if (l !== LINK_SEGMENT) usedRailways.add(l);
    for (const s of p.stops) usedRecords.add(s);
  }
  // 使う駅レコードの路線（統合後）は、区間がなくても路線として残す
  for (const r of usedRecords) usedRailways.add(canon[railwayIndex.get(input.stations[r].railway!)!]);
  const lineNewIndex = new Map<number, number>();
  const lines: Line[] = [];
  input.railways.forEach((r, i) => {
    if (!usedRailways.has(i)) return;
    lineNewIndex.set(i, lines.length);
    lines.push({
      name: r.title.ja ?? r.id,
      en: r.title.en ?? '',
      company: operatorName(r.id),
      color: r.color ? r.color.replace(/^#/, '') : null,
    });
  });
  const droppedRailways = input.railways.filter((_, i) => !usedRailways.has(i)).map((r) => r.id);
  log.push(`路線: ${lines.length} 本（無料列車のサービスがなく除外: ${droppedRailways.length} 本）`);
  if (droppedRailways.length > 0) log.push(`  除外した路線: ${droppedRailways.join(', ')}`);

  const stationNewIndex = new Map<number, number>();
  const stationOld: number[] = [];
  input.stations.forEach((_, i) => {
    if (!usedRecords.has(i)) return;
    stationNewIndex.set(i, stationOld.length);
    stationOld.push(i);
  });

  // ---- 8. 乗換グループ ----
  const uf = new UnionFind(stationOld.length);
  let groupedComplexes = 0;
  for (const complex of input.stationGroups) {
    const members: number[] = [];
    for (const sub of complex) {
      for (const id of sub) {
        const old = stationIndex.get(id);
        const ni = old === undefined ? undefined : stationNewIndex.get(old);
        if (ni !== undefined) members.push(ni);
      }
    }
    for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]);
    if (members.length >= 2) groupedComplexes++;
  }
  let alternatePairs = 0;
  stationOld.forEach((old, ni) => {
    const alt = input.stations[old].alternate;
    if (!alt) return;
    const altOld = stationIndex.get(alt);
    const altNew = altOld === undefined ? undefined : stationNewIndex.get(altOld);
    if (altNew !== undefined) {
      uf.union(ni, altNew);
      alternatePairs++;
    }
  });
  // MT3D のグループ定義に漏れている「同名かつごく近接（NEAR_SAME_NAME_M 以内）」の駅も同一グループにする
  // （例: 大江戸線 豊島園 と 西武豊島線 豊島園）。
  const byName = new Map<string, number[]>();
  stationOld.forEach((old, ni) => {
    const name = input.stations[old].title!.ja!;
    const arr = byName.get(name);
    if (arr) arr.push(ni);
    else byName.set(name, [ni]);
  });
  let nearPairs = 0;
  for (const ids of byName.values()) {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        if (uf.find(ids[a]) === uf.find(ids[b])) continue;
        const sa = input.stations[stationOld[ids[a]]].coord!;
        const sb = input.stations[stationOld[ids[b]]].coord!;
        const dy = (sa[1] - sb[1]) * 111000;
        const dx = (sa[0] - sb[0]) * 111000 * Math.cos((sa[1] * Math.PI) / 180);
        if (Math.hypot(dx, dy) <= NEAR_SAME_NAME_M) {
          uf.union(ids[a], ids[b]);
          nearPairs++;
        }
      }
    }
  }
  // ---- 乗換グループの手動調整（overrides） ----
  const names = stationOld.map((old) => input.stations[old].title!.ja!);
  const groupKey = stationOld.map((_, ni) => uf.find(ni));
  let nextKey = stationOld.length; // split 用の新規キー（union-find の根と衝突しない値）
  const noQuestion = new Set<number>(); // 出題除外グループのキー（最終的に駅へ展開）
  const ov = input.overrides;
  const findGroup = (kind: string, listed: string[]): number => {
    const keys = new Set<number>();
    const byKey = new Map<number, Set<string>>();
    groupKey.forEach((k, ni) => {
      let set = byKey.get(k);
      if (!set) byKey.set(k, (set = new Set()));
      set.add(names[ni]);
    });
    for (const [k, set] of byKey) if (listed.every((n) => set.has(n))) keys.add(k);
    if (keys.size !== 1) {
      throw new Error(`overrides.${kind} [${listed.join(', ')}]: 該当する乗換グループが ${keys.size} 件です（1件である必要があります）`);
    }
    return [...keys][0];
  };
  for (const listed of ov?.split ?? []) {
    const key = findGroup('split', listed);
    const members = groupKey.flatMap((k, ni) => (k === key ? [ni] : []));
    const missing = [...new Set(members.map((ni) => names[ni]))].filter((n) => !listed.includes(n));
    if (missing.length > 0) {
      throw new Error(`overrides.split [${listed.join(', ')}]: グループ内の駅名 ${missing.join(', ')} が列挙されていません`);
    }
    const newKeyOf = new Map<string, number>();
    for (const ni of members) {
      let nk = newKeyOf.get(names[ni]);
      if (nk === undefined) newKeyOf.set(names[ni], (nk = nextKey++));
      groupKey[ni] = nk;
    }
  }
  for (const [a, b] of ov?.merge ?? []) {
    const ka = findGroup('merge', a);
    const kb = findGroup('merge', b);
    if (ka === kb) throw new Error(`overrides.merge [${a.join(', ')}] と [${b.join(', ')}] は既に同じグループです`);
    groupKey.forEach((k, ni) => {
      if (k === kb) groupKey[ni] = ka;
    });
  }
  for (const listed of ov?.exclude ?? []) noQuestion.add(findGroup('exclude', listed));

  const groupIdOfRoot = new Map<number, number>();
  const stations: Station[] = stationOld.map((old, ni) => {
    const s = input.stations[old];
    const root = groupKey[ni];
    let g = groupIdOfRoot.get(root);
    if (g === undefined) {
      g = groupIdOfRoot.size;
      groupIdOfRoot.set(root, g);
    }
    const st: Station = {
      name: s.title!.ja!,
      en: s.title!.en ?? '',
      lon: Math.round(s.coord![0] * 100000) / 100000,
      lat: Math.round(s.coord![1] * 100000) / 100000,
      group: g,
      line: lineNewIndex.get(canon[railwayIndex.get(s.railway!)!])!,
    };
    if (noQuestion.has(root)) st.noQuestion = true;
    return st;
  });
  for (const name of ov?.excludeNames ?? []) {
    const hits = stations.filter((st) => st.name === name);
    if (hits.length === 0) throw new Error(`excludeNames: 駅名「${name}」の駅が見つかりません`);
    for (const st of hits) st.noQuestion = true;
  }
  log.push(
    `駅レコード: ${stations.length} 件 / 乗換グループ: ${groupIdOfRoot.size} 件（station-groups ${groupedComplexes} 件、alternate ${alternatePairs} 件、同名近接 ${nearPairs} 件を統合）`
  );
  log.push(
    `手動調整: split ${ov?.split?.length ?? 0} 件、merge ${ov?.merge?.length ?? 0} 件、exclude ${ov?.exclude?.length ?? 0} 件、excludeNames ${ov?.excludeNames?.length ?? 0} 件（出題除外駅レコード ${stations.filter((x) => x.noQuestion).length} 件）`
  );

  // ---- 乗降客数（S12）の対応付け ----
  if (input.s12) {
    const res = matchRidership(
      stations.map((st) => ({ name: st.name, lon: st.lon, lat: st.lat, company: lines[st.line].company })),
      input.s12
    );
    res.ridership.forEach((r, i) => {
      if (r !== undefined) stations[i].ridership = r;
    });
    const total = new Map<number, number>();
    const members = new Map<number, number[]>();
    stations.forEach((st, i) => {
      const arr = members.get(st.group);
      if (arr) arr.push(i);
      else members.set(st.group, [i]);
      if (st.ridership !== undefined) total.set(st.group, (total.get(st.group) ?? 0) + st.ridership);
    });
    const candidates = [...members.keys()].filter((g) => members.get(g)!.some((i) => !stations[i].noQuestion));
    const withData = candidates.filter((g) => total.has(g));
    const groupName = (g: number) => {
      const ms = members.get(g)!;
      return [...new Set(ms.map((i) => stations[i].name))].join('/');
    };
    log.push(
      `乗降客数(S12): 有効レコード ${input.s12.length} 件 → 対応付け ${res.matched} 件（重複掲載 ${res.deduped} 件を除外、未対応 ${res.unmatched.length} 件）`
    );
    log.push(`  出題候補グループ ${candidates.length} 件中 ${withData.length} 件に乗降客数を付与`);
    const top = [...withData].sort((a, b) => total.get(b)! - total.get(a)!).slice(0, 30);
    log.push('  乗降客数 上位30グループ: ' + top.map((g) => `${groupName(g)}(${total.get(g)})`).join('、'));
    const unmatchedGroups = candidates
      .filter((g) => !total.has(g))
      .sort((a, b) => members.get(b)!.length - members.get(a)!.length)
      .slice(0, 20);
    log.push('  未対応グループ(駅レコード数順 上位20): ' + unmatchedGroups.map((g) => `${groupName(g)}[${members.get(g)!.length}]`).join('、'));
    const unmatchedS12 = [...res.unmatched].sort((a, b) => b.ridership - a.ridership);
    const inRegion = unmatchedS12.filter((r) => {
      const [x, y] = r.coords[0];
      return x > 138.8 && x < 140.9 && y > 35.0 && y < 36.3;
    });
    log.push(
      `  MT3D側に対応が無かった関東圏の S12 レコード ${inRegion.length} 件（乗降客数順 上位15）: ` +
        inRegion.slice(0, 15).map((r) => `${r.name}/${r.company}/${r.line}(${r.ridership})`).join('、')
    );
  } else {
    log.push('乗降客数(S12): 入力なし（ridership なしでビルド）');
  }

  // ---- 9. 出力用パターン ----
  const patterns: Pattern[] = retained.map((p) => ({
    stops: p.stops.map((s) => stationNewIndex.get(s)!),
    segSec: p.segSec,
    segLine: p.segLine.map((l) => (l === LINK_SEGMENT ? LINK_SEGMENT : lineNewIndex.get(l)!)),
  }));
  // 出力の再現性のため、先頭駅・長さで安定ソート
  patterns.sort((a, b) => a.stops[0] - b.stops[0] || a.stops.length - b.stops.length || compareArrays(a.stops, b.stops));

  const network: Network = {
    formatVersion: 3,
    stations,
    lines,
    patterns,
    transferSec: TRANSFER_SEC,
  };
  return { network, log };
}

/**
 * segmentLineOverrides を運用(run)に適用する（runs を直接書き換える）。
 * 範囲内の区間は路線を付け替え、両端の駅レコードを付け替え先路線の同名レコードに置き換える。
 * 駅レコードが区間ごとに食い違う箇所（範囲の境界）には距離ゼロの直通リンクを挿入する。
 */
function applySegmentLineOverrides(
  input: Mt3dInput,
  runs: Run[],
  railwayIndex: Map<string, number>,
  canon: number[],
  log: string[]
): void {
  const list = input.overrides?.segmentLineOverrides ?? [];
  if (list.length === 0) return;
  const nameOf = (id: string): string | undefined => input.stations.find((x) => x.id === id)?.title?.ja;
  const recordIdx = new Map<string, number>();
  input.stations.forEach((st, i) => recordIdx.set(st.id, i));

  interface Rule {
    /** 付け替え元の railway（統合後の添字）。 */
    src: number;
    /** 付け替え先の railway（統合後の添字）。 */
    dst: number;
    /** 範囲内の駅レコード（入力 stations の添字）-> 付け替え先の同名レコード。 */
    map: Map<number, number>;
  }
  const rules: Rule[] = [];
  for (const o of list) {
    const label = `segmentLineOverrides ${o.railway} ${o.from}-${o.to}`;
    const src = railwayIndex.get(o.railway);
    const dst = railwayIndex.get(o.line);
    if (src === undefined) throw new Error(`${label}: railway ${o.railway} が存在しません`);
    if (dst === undefined) throw new Error(`${label}: line ${o.line} が存在しません`);
    const ids = input.railways[src].stations;
    const posOf = (name: string): number => {
      const p = ids.findIndex((id) => nameOf(id) === name);
      if (p < 0) throw new Error(`${label}: 駅「${name}」が ${o.railway} にありません`);
      return p;
    };
    const a = posOf(o.from);
    const b = posOf(o.to);
    const map = new Map<number, number>();
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
      const name = nameOf(ids[p]);
      const target = input.railways[dst].stations.find((id) => nameOf(id) === name);
      if (target === undefined) throw new Error(`${label}: 駅「${name}」が ${o.line} にありません`);
      const rec = recordIdx.get(ids[p]);
      const trec = recordIdx.get(target);
      if (rec === undefined || trec === undefined) throw new Error(`${label}: 駅レコード ${ids[p]} / ${target} が stations にありません`);
      map.set(rec, trec);
    }
    rules.push({ src: canon[src], dst: canon[dst], map });
  }

  let changedSegs = 0;
  for (const run of runs) {
    const n = run.nodes.length;
    // 区間ごとの付け替え後 (路線, 始点レコード, 終点レコード)
    const segs = run.segRailway.map((line, i) => {
      let from = run.nodes[i].record;
      let to = run.nodes[i + 1].record;
      let ln = line;
      for (const r of rules) {
        if (line === r.src && r.map.has(from) && r.map.has(to)) {
          from = r.map.get(from)!;
          to = r.map.get(to)!;
          ln = r.dst;
          changedSegs++;
          break;
        }
      }
      return { line: ln, from, to, sec: 0 };
    });
    if (!segs.some((s, i) => s.line !== run.segRailway[i])) continue;
    const nodes: RunNode[] = [];
    const segRailway: number[] = [];
    nodes.push({ record: segs[0].from, time: run.nodes[0].time });
    for (let i = 0; i < n - 1; i++) {
      const cur = nodes[nodes.length - 1];
      // 元から直通リンクの区間は、始点が付け替えで変わっても二重にリンクを挟まず、そのまま前のレコードから張る
      if (run.segRailway[i] !== LINK_SEGMENT && cur.record !== segs[i].from) {
        // 境界: 距離ゼロの直通リンクを挿入
        segRailway.push(LINK_SEGMENT);
        nodes.push({ record: segs[i].from, time: cur.time });
      }
      segRailway.push(segs[i].line);
      nodes.push({ record: segs[i].to, time: run.nodes[i + 1].time });
    }
    run.nodes = nodes;
    run.segRailway = segRailway;
  }
  log.push(`区間の路線の付け替え: ${list.length} 件の設定で ${changedSegs} 区間（運用内）を付け替え`);
}

function compareArrays(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
