import type { Line, Network, Pattern, Station } from '../../src/lib/types.ts';

/**
 * テスト用のミニネットワーク（駅データ.jp CSV + 国土数値情報N02 ベースの Network v2）を
 * ビルドパイプラインを介さず手組みで提供するフィクスチャ。
 *
 * トポロジ概要:
 *
 * - 山手線（JR東日本, lineType 2, color '9ACD32'）: 環状。
 *   停車順: 東京 - 神田 - 秋葉原 - 上野 - 池袋 - 新宿 - 渋谷 - 品川 -(→東京 再掲)
 *   segSec: [200, 200, 200, 300, 300, 400, 200, 120]（合計1920秒で一周）
 *
 * - 中央線（JR東日本, lineType 2, color 'F15A22'）:
 *   停車順: 東京 - 御茶ノ水 - 四ツ谷 - 新宿
 *   segSec: [180, 240, 240]
 *
 * - 丸ノ内線（東京メトロ, lineType 3, color 'F62E36'）:
 *   停車順: 池袋 - 御茶ノ水 - 大手町 - 東京 - 四ツ谷 - 新宿
 *   segSec: [420, 300, 300, 600, 600]
 *
 * - テスト電鉄本線（テスト電鉄, lineType 0, color null）: Y字分岐。
 *   幹: 新宿 - 初台 - 本村、分岐: 本村 -> 東山 / 本村 -> 西丘
 *   葉ペア全列挙で3パターン:
 *     [新宿, 初台, 本村, 東山]（segSec [200,200,200]）
 *     [新宿, 初台, 本村, 西丘]（segSec [200,200,200]）
 *     [東山, 本村, 西丘]（segSec [200,200]）
 *
 * - transferSec = 300、formatVersion: 2。
 *
 * 駅レコードは路線ごとに別レコード（実データ同様）。同一物理駅は同一 group で束ねる。
 * 東京: 山手線用・中央線用・丸ノ内線用の3レコード（同一group）。
 * 池袋: 山手線用・丸ノ内線用（同一group）。
 * 新宿: 山手線用・中央線用・丸ノ内線用・テスト電鉄用の4レコード（同一group）。
 * 御茶ノ水: 中央線用・丸ノ内線用（同一group）。
 * 四ツ谷: 中央線用・丸ノ内線用（同一group）。
 *
 * ============================================================
 * 検証シナリオの手計算（FIXTURE_EXPECTATIONS と対応）
 * ============================================================
 *
 * 1. 東京 -> 新宿 (time モード):
 *    - 中央線直通: 180+240+240 = 660秒 (0乗換)
 *    - 丸ノ内線直通: 1020(池袋 -> 東京の累積) 起点は東京=累積1020、新宿=累積2220 -> 差分1200秒 (0乗換)
 *    - 山手線 東京 -> 新宿 (品川側・短い方): 東京から逆方向(品川, 渋谷経由)で
 *      seg[Shinagawa-Tokyo]=120 + seg[Shibuya-Shinagawa]=200 + seg[Shinjuku-Shibuya]=400 = 720秒
 *      (山手線 東京 -> 新宿 正方向(神田側): 200+200+200+300+300=1200秒 の方が長い)
 *    - 660 < 720 < 1200 なので中央線直通の660秒が最速。 [ tokyoToShinjuku.time ]
 *
 * 2. 品川 -> 上野 (山手線のみ):
 *    - 品川 -> 東京 -> 神田 -> 秋葉原 -> 上野 (東京経由・短い方):
 *      seg[Shinagawa-Tokyo]=120 + seg[Tokyo-Kanda]=200 + seg[Kanda-Akihabara]=200 + seg[Akihabara-Ueno]=200 = 720秒
 *    - 品川 -> 渋谷 -> 新宿 -> 池袋 -> 上野 (新宿経由・長い方):
 *      seg[Shibuya-Shinagawa]=200 + seg[Shinjuku-Shibuya]=400 + seg[Ikebukuro-Shinjuku]=300 + seg[Ueno-Ikebukuro]=300 = 1200秒
 *    - 720 < 1200 なので東京経由の720秒が最短。 [ shinagawaToUeno.time ]
 *
 * 3. 東山 -> 大手町:
 *    - テスト電鉄 東山 -> 新宿: 200+200+200 = 600秒
 *    - transfers モード: テスト電鉄(東山->新宿 600秒) -> 乗換(300秒) -> 丸ノ内線(新宿->大手町):
 *      新宿の累積2220、大手町の累積720 -> 差分1500秒
 *      合計 = 600 + 300 + 1500 = 2400秒、乗換1回。
 *    - time モード: テスト電鉄(東山->新宿 600秒) -> 乗換(300秒) -> 中央線(新宿->御茶ノ水):
 *      新宿の累積660、御茶ノ水の累積180 -> 差分480秒
 *      -> 乗換(300秒) -> 丸ノ内線(御茶ノ水->大手町): 御茶ノ水の累積420、大手町の累積720 -> 差分300秒
 *      合計 = 600 + 300 + 480 + 300 + 300 = 1980秒、乗換2回。
 *    - 1980 < 2400 なので time モードでは乗換2回の経路が選ばれ、transfers モードでは乗換1回の経路が選ばれる
 *      （モードにより最適解が分岐する）。 [ higashiyamaToOtemachi ]
 *
 * 4. 東山 -> 西丘:
 *    - テスト電鉄の葉ペアパターン [東山, 本村, 西丘] 内で完結: segSec 200+200 = 400秒、乗換0回。
 *      （新宿を経由する [東山...新宿]+[新宿...西丘] のような乗換ルートは使われない）
 *      [ higashiyamaToNishioka.time ]
 */

// ---- station index 定数（miniNetwork() の stations 配列の並びと対応させる） ----
const S_TOKYO_YAMANOTE = 0;
const S_TOKYO_CHUO = 1;
const S_TOKYO_MARUNOUCHI = 2;
const S_KANDA = 3;
const S_AKIHABARA = 4;
const S_UENO = 5;
const S_IKEBUKURO_YAMANOTE = 6;
const S_IKEBUKURO_MARUNOUCHI = 7;
const S_SHINJUKU_YAMANOTE = 8;
const S_SHINJUKU_CHUO = 9;
const S_SHINJUKU_MARUNOUCHI = 10;
const S_SHINJUKU_TESTTETSU = 11;
const S_SHIBUYA = 12;
const S_SHINAGAWA = 13;
const S_OCHANOMIZU_CHUO = 14;
const S_OCHANOMIZU_MARUNOUCHI = 15;
const S_OTEMACHI = 16;
const S_YOTSUYA_CHUO = 17;
const S_YOTSUYA_MARUNOUCHI = 18;
const S_HATSUDAI = 19;
const S_HONMURA = 20;
const S_HIGASHIYAMA = 21;
const S_NISHIOKA = 22;

// ---- group 定数（物理駅） ----
const G_TOKYO = 0;
const G_KANDA = 1;
const G_AKIHABARA = 2;
const G_UENO = 3;
const G_IKEBUKURO = 4;
const G_SHINJUKU = 5;
const G_SHIBUYA = 6;
const G_SHINAGAWA = 7;
const G_OCHANOMIZU = 8;
const G_OTEMACHI = 9;
const G_YOTSUYA = 10;
const G_HATSUDAI = 11;
const G_HONMURA = 12;
const G_HIGASHIYAMA = 13;
const G_NISHIOKA = 14;

/** 手組みの Network v2 を返す（ビルドパイプラインを介さない）。 */
export function miniNetwork(): Network {
  const stations: Station[] = [
    { name: '東京', lat: 35.681, lon: 139.767, group: G_TOKYO }, // 0 yamanote
    { name: '東京', lat: 35.681, lon: 139.767, group: G_TOKYO }, // 1 chuo
    { name: '東京', lat: 35.681, lon: 139.767, group: G_TOKYO }, // 2 marunouchi
    { name: '神田', lat: 35.6917, lon: 139.7708, group: G_KANDA }, // 3
    { name: '秋葉原', lat: 35.6984, lon: 139.7731, group: G_AKIHABARA }, // 4
    { name: '上野', lat: 35.7138, lon: 139.777, group: G_UENO }, // 5
    { name: '池袋', lat: 35.7289, lon: 139.71, group: G_IKEBUKURO }, // 6 yamanote
    { name: '池袋', lat: 35.7289, lon: 139.71, group: G_IKEBUKURO }, // 7 marunouchi
    { name: '新宿', lat: 35.69, lon: 139.7004, group: G_SHINJUKU }, // 8 yamanote
    { name: '新宿', lat: 35.69, lon: 139.7004, group: G_SHINJUKU }, // 9 chuo
    { name: '新宿', lat: 35.69, lon: 139.7004, group: G_SHINJUKU }, // 10 marunouchi
    { name: '新宿', lat: 35.69, lon: 139.7004, group: G_SHINJUKU }, // 11 testtetsu
    { name: '渋谷', lat: 35.658, lon: 139.7016, group: G_SHIBUYA }, // 12
    { name: '品川', lat: 35.6285, lon: 139.7387, group: G_SHINAGAWA }, // 13
    { name: '御茶ノ水', lat: 35.6993, lon: 139.7649, group: G_OCHANOMIZU }, // 14 chuo
    { name: '御茶ノ水', lat: 35.6993, lon: 139.7649, group: G_OCHANOMIZU }, // 15 marunouchi
    { name: '大手町', lat: 35.6867, lon: 139.7649, group: G_OTEMACHI }, // 16
    { name: '四ツ谷', lat: 35.686, lon: 139.73, group: G_YOTSUYA }, // 17 chuo
    { name: '四ツ谷', lat: 35.686, lon: 139.73, group: G_YOTSUYA }, // 18 marunouchi
    { name: '初台', lat: 35.6822, lon: 139.6875, group: G_HATSUDAI }, // 19
    { name: '本村', lat: 35.675, lon: 139.68, group: G_HONMURA }, // 20
    { name: '東山', lat: 35.67, lon: 139.67, group: G_HIGASHIYAMA }, // 21
    { name: '西丘', lat: 35.68, lon: 139.66, group: G_NISHIOKA }, // 22
  ];

  const yamanotePattern: Pattern = {
    stops: [
      S_TOKYO_YAMANOTE,
      S_KANDA,
      S_AKIHABARA,
      S_UENO,
      S_IKEBUKURO_YAMANOTE,
      S_SHINJUKU_YAMANOTE,
      S_SHIBUYA,
      S_SHINAGAWA,
      S_TOKYO_YAMANOTE, // 環状: 始点を末尾に再掲
    ],
    segSec: [200, 200, 200, 300, 300, 400, 200, 120],
  };

  const chuoPattern: Pattern = {
    stops: [S_TOKYO_CHUO, S_OCHANOMIZU_CHUO, S_YOTSUYA_CHUO, S_SHINJUKU_CHUO],
    segSec: [180, 240, 240],
  };

  const marunouchiPattern: Pattern = {
    stops: [
      S_IKEBUKURO_MARUNOUCHI,
      S_OCHANOMIZU_MARUNOUCHI,
      S_OTEMACHI,
      S_TOKYO_MARUNOUCHI,
      S_YOTSUYA_MARUNOUCHI,
      S_SHINJUKU_MARUNOUCHI,
    ],
    segSec: [420, 300, 300, 600, 600],
  };

  // テスト電鉄本線: Y字分岐。葉ペア（新宿/東山, 新宿/西丘, 東山/西丘）を全列挙して3パターン。
  const testTetsuShinjukuHigashiyama: Pattern = {
    stops: [S_SHINJUKU_TESTTETSU, S_HATSUDAI, S_HONMURA, S_HIGASHIYAMA],
    segSec: [200, 200, 200],
  };
  const testTetsuShinjukuNishioka: Pattern = {
    stops: [S_SHINJUKU_TESTTETSU, S_HATSUDAI, S_HONMURA, S_NISHIOKA],
    segSec: [200, 200, 200],
  };
  const testTetsuHigashiyamaNishioka: Pattern = {
    stops: [S_HIGASHIYAMA, S_HONMURA, S_NISHIOKA],
    segSec: [200, 200],
  };

  const lines: Line[] = [
    {
      name: '山手線',
      company: 'JR東日本',
      color: '9ACD32',
      lineType: 2,
      patterns: [yamanotePattern],
    },
    {
      name: '中央線',
      company: 'JR東日本',
      color: 'F15A22',
      lineType: 2,
      patterns: [chuoPattern],
    },
    {
      name: '丸ノ内線',
      company: '東京メトロ',
      color: 'F62E36',
      lineType: 3,
      patterns: [marunouchiPattern],
    },
    {
      name: 'テスト電鉄本線',
      company: 'テスト電鉄',
      color: null,
      lineType: 0,
      patterns: [
        testTetsuShinjukuHigashiyama,
        testTetsuShinjukuNishioka,
        testTetsuHigashiyamaNishioka,
      ],
    },
  ];

  return {
    formatVersion: 2,
    stations,
    lines,
    transferSec: 300,
  };
}

/** miniNetwork() の検証シナリオに対応する期待値。数値は上記コメントの手計算どおり。 */
export const FIXTURE_EXPECTATIONS = {
  tokyoToShinjuku: { time: { totalSec: 660, transfers: 0, line: '中央線' } },
  shinagawaToUeno: { time: { totalSec: 720, transfers: 0 } },
  higashiyamaToOtemachi: {
    transfersMode: { totalSec: 2400, transfers: 1 },
    timeMode: { totalSec: 1980, transfers: 2 },
  },
  higashiyamaToNishioka: { time: { totalSec: 400, transfers: 0 } },
} as const;

// ============================================================
// ビルドパイプラインテスト用の生入力（駅データ.jp CSV 相当 / N02 GeoJSON 相当）
// ============================================================

/** 駅データ.jp CSV と同スキーマの生レコード群。カラム名は実仕様どおり。 */
export interface MiniEkidataInput {
  companies: Record<string, string>[];
  lines: Record<string, string>[];
  stations: Record<string, string>[];
  joins: Record<string, string>[];
}

function company(
  company_cd: string,
  rr_cd: string,
  company_name: string,
  company_type: string
): Record<string, string> {
  return {
    company_cd,
    rr_cd,
    company_name,
    company_name_k: '',
    company_name_h: '',
    company_name_r: '',
    company_url: '',
    company_type,
    e_status: '0',
    e_sort: company_cd,
  };
}

function lineRow(
  line_cd: string,
  company_cd: string,
  line_name: string,
  line_color_c: string
): Record<string, string> {
  return {
    line_cd,
    company_cd,
    line_name,
    line_name_k: '',
    line_name_h: '',
    line_color_c,
    line_color_t: '',
    line_type: '', // 無料版には無い
    lon: '',
    lat: '',
    zoom: '',
    e_status: '0',
    e_sort: line_cd,
  };
}

function stationRow(
  station_cd: string,
  station_g_cd: string,
  station_name: string,
  line_cd: string,
  lon: number,
  lat: number,
  e_status: string
): Record<string, string> {
  return {
    station_cd,
    station_g_cd,
    station_name,
    station_name_k: '',
    station_name_r: '',
    line_cd,
    pref_cd: '13',
    post: '',
    address: '',
    lon: String(lon),
    lat: String(lat),
    open_ymd: '',
    close_ymd: e_status === '2' ? '2020-01-01' : '',
    e_status,
    e_sort: station_cd,
  };
}

function joinRow(line_cd: string, station_cd1: string, station_cd2: string): Record<string, string> {
  return { line_cd, station_cd1, station_cd2 };
}

/**
 * miniNetwork() と同じトポロジを、駅データ.jp CSV 相当の生レコードとして提供する
 * （ビルドパイプラインのテスト用）。
 *
 * 追加要素:
 * - 廃駅テスト用に e_status='2' の駅1つと、それを参照する join 行。
 * - どの join にも現れない孤立駅1つ（e_status='0'）。
 * - 山手線の join は環状（品川-東京を閉じる）。
 * - カナ列・line_type は空文字（無料版に無いため）。
 * - line_color_c は山手線・中央線・丸ノ内線のみ設定、テスト電鉄は空。
 */
export function miniEkidataInput(): MiniEkidataInput {
  const companies = [
    company('1', '', 'JR東日本', '1'),
    company('2', '', '東京メトロ', '2'),
    company('3', '', 'テスト電鉄', '0'),
  ];

  const lines = [
    lineRow('10001', '1', '山手線', '9ACD32'),
    lineRow('10002', '1', '中央線', 'F15A22'),
    lineRow('20001', '2', '丸ノ内線', 'F62E36'),
    lineRow('30001', '3', 'テスト電鉄本線', ''),
  ];

  // station_g_cd は物理駅（group）を表す駅データ.jpの慣習に合わせ、駅名ベースの共通コードにする。
  const G = {
    tokyo: 'G_TOKYO',
    kanda: 'G_KANDA',
    akihabara: 'G_AKIHABARA',
    ueno: 'G_UENO',
    ikebukuro: 'G_IKEBUKURO',
    shinjuku: 'G_SHINJUKU',
    shibuya: 'G_SHIBUYA',
    shinagawa: 'G_SHINAGAWA',
    ochanomizu: 'G_OCHANOMIZU',
    otemachi: 'G_OTEMACHI',
    yotsuya: 'G_YOTSUYA',
    hatsudai: 'G_HATSUDAI',
    honmura: 'G_HONMURA',
    higashiyama: 'G_HIGASHIYAMA',
    nishioka: 'G_NISHIOKA',
  };

  const stations: Record<string, string>[] = [
    // 山手線 (line_cd 10001)
    stationRow('YMN01', G.tokyo, '東京', '10001', 139.767, 35.681, '0'),
    stationRow('YMN02', G.kanda, '神田', '10001', 139.7708, 35.6917, '0'),
    stationRow('YMN03', G.akihabara, '秋葉原', '10001', 139.7731, 35.6984, '0'),
    stationRow('YMN04', G.ueno, '上野', '10001', 139.777, 35.7138, '0'),
    stationRow('YMN05', G.ikebukuro, '池袋', '10001', 139.71, 35.7289, '0'),
    stationRow('YMN06', G.shinjuku, '新宿', '10001', 139.7004, 35.69, '0'),
    stationRow('YMN07', G.shibuya, '渋谷', '10001', 139.7016, 35.658, '0'),
    stationRow('YMN08', G.shinagawa, '品川', '10001', 139.7387, 35.6285, '0'),
    // 中央線 (line_cd 10002)
    stationRow('CHU01', G.tokyo, '東京', '10002', 139.767, 35.681, '0'),
    stationRow('CHU02', G.ochanomizu, '御茶ノ水', '10002', 139.7649, 35.6993, '0'),
    stationRow('CHU03', G.yotsuya, '四ツ谷', '10002', 139.73, 35.686, '0'),
    stationRow('CHU04', G.shinjuku, '新宿', '10002', 139.7004, 35.69, '0'),
    // 丸ノ内線 (line_cd 20001)
    stationRow('MAR01', G.ikebukuro, '池袋', '20001', 139.71, 35.7289, '0'),
    stationRow('MAR02', G.ochanomizu, '御茶ノ水', '20001', 139.7649, 35.6993, '0'),
    stationRow('MAR03', G.otemachi, '大手町', '20001', 139.7649, 35.6867, '0'),
    stationRow('MAR04', G.tokyo, '東京', '20001', 139.767, 35.681, '0'),
    stationRow('MAR05', G.yotsuya, '四ツ谷', '20001', 139.73, 35.686, '0'),
    stationRow('MAR06', G.shinjuku, '新宿', '20001', 139.7004, 35.69, '0'),
    // テスト電鉄本線 (line_cd 30001)
    stationRow('TST01', G.shinjuku, '新宿', '30001', 139.7004, 35.69, '0'),
    stationRow('TST02', G.hatsudai, '初台', '30001', 139.6875, 35.6822, '0'),
    stationRow('TST03', G.honmura, '本村', '30001', 139.68, 35.675, '0'),
    stationRow('TST04', G.higashiyama, '東山', '30001', 139.67, 35.67, '0'),
    stationRow('TST05', G.nishioka, '西丘', '30001', 139.66, 35.68, '0'),
    // 廃駅テスト用: e_status='2'（廃止駅）。テスト電鉄本線上にあった想定の廃駅。
    stationRow('TST99', 'G_HAISHI', '廃止駅', '30001', 139.65, 35.66, '2'),
    // 孤立駅テスト用: どの join にも現れない、e_status='0' の駅。
    stationRow('ISO01', 'G_ISOLATED', '孤立駅', '90001', 139.9, 35.9, '0'),
  ];

  const joins: Record<string, string>[] = [
    // 山手線: 環状（品川-東京を閉じる）
    joinRow('10001', 'YMN01', 'YMN02'),
    joinRow('10001', 'YMN02', 'YMN03'),
    joinRow('10001', 'YMN03', 'YMN04'),
    joinRow('10001', 'YMN04', 'YMN05'),
    joinRow('10001', 'YMN05', 'YMN06'),
    joinRow('10001', 'YMN06', 'YMN07'),
    joinRow('10001', 'YMN07', 'YMN08'),
    joinRow('10001', 'YMN08', 'YMN01'), // 環状クローズ
    // 中央線
    joinRow('10002', 'CHU01', 'CHU02'),
    joinRow('10002', 'CHU02', 'CHU03'),
    joinRow('10002', 'CHU03', 'CHU04'),
    // 丸ノ内線
    joinRow('20001', 'MAR01', 'MAR02'),
    joinRow('20001', 'MAR02', 'MAR03'),
    joinRow('20001', 'MAR03', 'MAR04'),
    joinRow('20001', 'MAR04', 'MAR05'),
    joinRow('20001', 'MAR05', 'MAR06'),
    // テスト電鉄本線: Y字（新宿-初台-本村、本村-東山、本村-西丘）
    joinRow('30001', 'TST01', 'TST02'),
    joinRow('30001', 'TST02', 'TST03'),
    joinRow('30001', 'TST03', 'TST04'),
    joinRow('30001', 'TST03', 'TST05'),
    // 廃駅を参照する join（廃駅テスト用。TST04-TST99 という架空の廃止区間）
    joinRow('30001', 'TST04', 'TST99'),
    // ISO01 はどの join にも現れない（孤立駅）
  ];

  return { companies, lines, stations, joins };
}

/**
 * GeoJSON の最小限のローカル型定義（@types/geojson に依存しないための簡易宣言）。
 * N02実データの LineString Feature / FeatureCollection を表現できれば十分。
 */
export interface N02Feature {
  type: 'Feature';
  properties: {
    N02_001: string;
    N02_002: string;
    N02_003: string;
    N02_004: string;
    N02_005: string;
  };
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export interface N02FeatureCollection {
  type: 'FeatureCollection';
  features: N02Feature[];
}

/** N02（国土数値情報 鉄道時系列）のGeoJSON FeatureCollection 相当の生入力。 */
export interface MiniN02 {
  sections: N02FeatureCollection;
  stations: N02FeatureCollection;
}

function n02LineFeature(
  coordinates: [number, number][],
  n02_002: string,
  n02_003: string,
  n02_004: string,
  n02_005 = ''
): N02Feature {
  return {
    type: 'Feature',
    properties: {
      // N02_001 は鉄道区分の2桁コード（実データ例: '11'=普通鉄道）。
      // ビルダーは N02_002（事業者種別コード）のみで新幹線をフィルタするため、この値は動作に影響しない。
      N02_001: '11',
      N02_002: n02_002, // 事業者種別コード（'1' = 新幹線）
      N02_003: n02_003, // 路線名
      N02_004: n02_004, // 事業者名
      // N02_005: 駅フィーチャでは駅名（例: '東京'）。区間（sections）フィーチャでは空文字。
      // Phase 1C の「駅名NFKC一致＋距離1km以内で駅データ.jp側グループへ統合する」ヒューリスティックが参照する。
      N02_005: n02_005,
    },
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

/**
 * ミニ東海道新幹線（東京 -> 品川 -> 新横浜）を N02 実スキーマ相当で提供する。
 * 東京・品川の座標は miniEkidataInput の同名駅と1km以内（グループ統合ヒューリスティックの検証用）。
 * 新横浜は miniEkidataInput に存在しない新規駅。
 */
export function miniN02(): MiniN02 {
  // miniEkidataInput の 東京(139.767, 35.681) / 品川(139.7387, 35.6285) から1km以内にずらした座標
  const tokyoN02: [number, number] = [139.7675, 35.6815];
  const shinagawaN02: [number, number] = [139.7391, 35.629];
  const shinYokohamaN02: [number, number] = [139.6172, 35.5074];

  const sections: N02FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      n02LineFeature([tokyoN02, shinagawaN02], '1', '東海道新幹線', '東海旅客鉄道'),
      n02LineFeature([shinagawaN02, shinYokohamaN02], '1', '東海道新幹線', '東海旅客鉄道'),
    ],
  };

  // N02の駅レイヤーは短いLineString（駅前後の微小区間）として表現される慣習に合わせる。
  const stationEps = 0.0005;
  const stations: N02FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      n02LineFeature(
        [
          [tokyoN02[0] - stationEps, tokyoN02[1]],
          [tokyoN02[0] + stationEps, tokyoN02[1]],
        ],
        '1',
        '東海道新幹線',
        '東海旅客鉄道',
        '東京'
      ),
      n02LineFeature(
        [
          [shinagawaN02[0] - stationEps, shinagawaN02[1]],
          [shinagawaN02[0] + stationEps, shinagawaN02[1]],
        ],
        '1',
        '東海道新幹線',
        '東海旅客鉄道',
        '品川'
      ),
      n02LineFeature(
        [
          [shinYokohamaN02[0] - stationEps, shinYokohamaN02[1]],
          [shinYokohamaN02[0] + stationEps, shinYokohamaN02[1]],
        ],
        '1',
        '東海道新幹線',
        '東海旅客鉄道',
        '新横浜'
      ),
    ],
  };

  return { sections, stations };
}
