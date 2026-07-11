/**
 * TransitMaster 共有型定義（v2: 駅データ.jp CSV + 国土数値情報N02 ベース）。
 *
 * 旧型（GTFSの trips/fare/feed/FeedInfo や時刻ベースの depart/arrive 等）は完全に廃止し、
 * 駅間所要秒（segSec）による疑似所要時間モデルに全面移行した。
 * このファイルは後続の全実装が参照する「不変契約」であり、他のフェーズから変更しない。
 */

/** 出題・採点モード。'time' = 総所要時間最小、'transfers' = 乗換回数最小（同数ならtie-breakは実装依存）。 */
export type AnswerMode = 'time' | 'transfers';

/** 駅レコード。駅データ.jpの流儀に合わせ、同一の物理駅でも路線ごとに別レコードを持ちうる（group で束ねる）。 */
export interface Station {
  /** 駅名（表示用）。 */
  name: string;
  /** 緯度。 */
  lat: number;
  /** 経度。 */
  lon: number;
  /** 同一の物理駅（乗換可能な駅群）を束ねるグループID。異なる路線の同名・近傍駅は同じgroupを共有する。 */
  group: number;
  /**
   * 都道府県コード（駅データ.jp の pref_cd、1〜47）。
   * N02由来の新幹線単独駅などで判定できない場合は 0（不明）とし、UI側は都道府県表示をスキップする。
   */
  pref: number;
  /**
   * 駅名ふりがな（カタカナ。駅データ.jp の station_name_k が非空の場合のみ設定）。
   * 未収録の間は undefined（JSON では省略されるためサイズ増なし）。オートコンプリートの検索対象に使う。
   */
  kana?: string;
}

/**
 * 1路線内の停車駅パターン（系統）。
 * 環状パターンでは stops の末尾に始点駅を再掲する（stops[0] === stops[stops.length - 1]）。
 * segSec は隣接区間の所要秒で、segSec.length === stops.length - 1 を満たす
 * （segSec[i] は stops[i] -> stops[i+1] の所要秒）。
 */
export interface Pattern {
  /** 停車駅（station index）の並び。環状なら末尾に始点を再掲。 */
  stops: number[];
  /** 区間所要秒。stops[i]→stops[i+1] の所要時間。length === stops.length - 1。 */
  segSec: number[];
}

/**
 * 路線。
 * lineType はビルド時の分類器が付与する値であり、駅データ.jp無料版のCSVそのものには含まれない。
 * 0: その他, 1: 新幹線, 2: JR等在来線, 3: 地下鉄, 4: 路面電車, 5: モノレール・新交通システム
 */
export interface Line {
  /** 路線名。 */
  name: string;
  /** 事業者名。 */
  company: string;
  /** 路線カラー（#なしの16進、またはデータ欠如でnull）。 */
  color: string | null;
  /** ビルド時分類器が付与する路線種別。 */
  lineType: number;
  /** この路線が持つ停車パターン（系統）の一覧。 */
  patterns: Pattern[];
  /**
   * 路線名ふりがな（カタカナ。駅データ.jp の line_name_k が非空の場合のみ設定）。
   * 未収録の間は undefined（JSON では省略されるためサイズ増なし）。オートコンプリートの検索対象に使う。
   */
  kana?: string;
}

/** ネットワーク全体。formatVersion は将来の破壊的変更を検知するためのマーカー。 */
export interface Network {
  /** データフォーマットバージョン。現行は2固定。 */
  formatVersion: 2;
  /** 全駅レコード（station index で参照される）。 */
  stations: Station[];
  /** 全路線。 */
  lines: Line[];
  /** 同一グループ内の乗換に一律で加算する秒数（徒歩・乗換時間の疑似モデル）。 */
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
  /** この区間の乗車所要秒（対応するパターンのsegSecの合計）。 */
  rideSec: number;
}

/** 確定した経路全体。 */
export interface Itinerary {
  /** 区間の並び（出発から到着まで順）。 */
  legs: ItineraryLeg[];
  /** 乗車時間の合計秒（乗換時間を含まない）。 */
  rideSec: number;
  /** 総所要秒（乗車時間＋乗換ペナルティ）。 */
  totalSec: number;
  /** 乗換回数（legs.length - 1）。 */
  transfers: number;
}

/** ある回答候補（駅列・路線列）の評価結果。経路として成立しない場合は totalSec が null。 */
export interface RouteEvaluation {
  /** 乗換回数。 */
  transfers: number;
  /** 乗車時間の合計秒。 */
  rideSec: number;
  /** 総所要秒（乗車時間＋乗換ペナルティ）。経路として無効な場合は null。 */
  totalSec: number | null;
}
