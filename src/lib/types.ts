/**
 * TransitMaster 共有型定義（v3: Mini Tokyo 3D の時刻表データ ベース）。
 *
 * データ源は Mini Tokyo 3D（公共交通オープンデータセンター(ODPT)のデータを加工したもの）のみ。
 * 駅間所要秒（segSec）は実際の時刻表から「最速の1運用」の所要時間として算出する。
 * パターン（停車駅列）は列車の運用（直通運転を含む）単位で、有向（進行方向が決まっている）。
 * 直通運転は1つのパターンの中で路線をまたぐため、パターンは路線に属さずトップレベルに持つ。
 */

/** 出題・採点モード。'time' = 総所要時間最小、'transfers' = 乗換回数最小（同数なら所要時間最小）。 */
export type AnswerMode = 'time' | 'transfers';

/** 駅レコード。Mini Tokyo 3D の流儀に合わせ、同一の物理駅でも路線ごとに別レコードを持つ（group で束ねる）。 */
export interface Station {
  /** 駅名（表示用、日本語）。 */
  name: string;
  /** 駅名ローマ字（Mini Tokyo 3D の title.en。検索用）。 */
  en: string;
  /** 緯度。 */
  lat: number;
  /** 経度。 */
  lon: number;
  /** 同一の物理駅（乗換可能な駅群）を束ねるグループID。異なる路線の乗換駅は同じgroupを共有する。 */
  group: number;
  /** true の乗換グループ（data/transfer-group-overrides.json の exclude）は出題の出発駅・到着駅に使わない（経路途中・オートコンプリートでは使える）。false の場合は省略。 */
  noQuestion?: true;
  /** このレコードが属する路線（line index）。 */
  line: number;
  /**
   * 国土数値情報 S12（駅別乗降客数データ）から対応づけた、この駅レコードの1日あたり乗降客数（人/日、最新の有効な年）。
   * 対応する S12 レコードが無ければ省略。乗換グループ単位の乗降客数は、同じ group を持つレコードの値の合計
   * （S12 の1レコードは1つの駅レコードにだけ対応づけているので二重計上にはならない）。
   */
  ridership?: number;
}

/**
 * 有向の停車パターン（列車の運用単位）。
 * 環状パターンでは stops の末尾に始点駅を再掲する（stops[0] === stops[stops.length - 1]）。
 * segSec / segLine の長さは stops.length - 1 で、i番目は stops[i] -> stops[i+1] の区間。
 */
export interface Pattern {
  /** 停車駅（station index）の並び（進行方向順）。環状なら末尾に始点を再掲。 */
  stops: number[];
  /** 区間所要秒。stops[i]→stops[i+1] の所要時間。 */
  segSec: number[];
  /**
   * 区間が属する路線（line index）。直通運転で路線が切り替わる箇所は
   * 「直通リンク」（駅レコードが変わるだけの接続。距離ゼロ）の区間となり、LINK_SEGMENT (-1) を入れる。
   */
  segLine: number[];
}

/** segLine に入れる「直通リンク」区間の印。 */
export const LINK_SEGMENT = -1;

/** 路線。MT3D の railway に対応する。 */
export interface Line {
  /** 路線名（日本語）。 */
  name: string;
  /** 路線名ローマ字（検索用）。 */
  en: string;
  /** 事業者名。 */
  company: string;
  /** 路線カラー（#なしの16進、またはデータ欠如でnull）。 */
  color: string | null;
}

/** ネットワーク全体。formatVersion は将来の破壊的変更を検知するためのマーカー。 */
export interface Network {
  /** データフォーマットバージョン。現行は3固定。 */
  formatVersion: 3;
  /** 全駅レコード（station index で参照される）。 */
  stations: Station[];
  /** 全路線。 */
  lines: Line[];
  /** 全パターン（有向、路線をまたぎうる）。 */
  patterns: Pattern[];
  /** 同一グループ内の乗換（パターンの乗り換え）に一律で加算する秒数。 */
  transferSec: number;
}

/** 経路の1区間（未確定・探索途中の表現）。 */
export interface RouteLeg {
  /** 乗車する路線（line index）。 */
  line: number;
  /** 乗車駅（station index）。 */
  from: number;
  /** 降車駅（station index）。 */
  to: number;
}

/** 確定した経路の1区間。実際の乗車所要秒を伴う。 */
export interface ItineraryLeg extends RouteLeg {
  /** この区間の乗車所要秒（直通リンク区間の秒数を含む）。 */
  rideSec: number;
  /** true なら直前の区間から乗換なしで続けて乗る（直通運転）。 */
  through?: boolean;
}

/** 確定した経路全体。 */
export interface Itinerary {
  /** 区間の並び（出発から到着まで順）。 */
  legs: ItineraryLeg[];
  /** 乗車時間の合計秒（乗換ペナルティを含まない）。 */
  rideSec: number;
  /** 総所要秒（乗車時間＋乗換ペナルティ）。 */
  totalSec: number;
  /** 乗換回数（直通運転は乗換に数えない）。 */
  transfers: number;
}

/** ある回答候補（駅列・路線列）の評価結果。経路として成立しない場合は totalSec が null。 */
export interface RouteEvaluation {
  /** 乗換回数（直通運転は乗換に数えない）。 */
  transfers: number;
  /** 乗車時間の合計秒。 */
  rideSec: number;
  /** 総所要秒（乗車時間＋乗換ペナルティ）。経路として無効な場合は null。 */
  totalSec: number | null;
}
