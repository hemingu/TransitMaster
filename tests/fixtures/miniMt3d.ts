import { buildMt3dNetwork } from '../../scripts/buildMt3dNetwork.ts';
import type { Mt3dInput, Mt3dTrain, Mt3dStation } from '../../scripts/buildMt3dNetwork.ts';
import type { Network } from '../../src/lib/types.ts';

/**
 * テスト用のミニ Mini Tokyo 3D 形式入力（railways / stations / station-groups / train-types / train-timetables）。
 * 実データと同じ形式で、ビルド処理（有料列車除外・直通運用の連結・最速運用の選択・刈り込み・グループ化）を
 * 検証するためのフィクスチャ。
 *
 * ■ 路線と駅
 * - JR-East.Yamanote（山手線、環状）: 東京 - 上野 - 新宿 - 品川 -(東京)
 * - JR-East.Chuo（中央線）: 東京 - 新宿
 * - TokyoMetro.Fukutoshin（副都心線）: 池袋 - 新宿三丁目 - 渋谷
 * - Tokyu.Toyoko（東横線）: 渋谷 - 代官山 - 横浜
 * - Minatomirai.Minatomirai（みなとみらい線）: 横浜 - 元町・中華街
 * - Toei.Oedo（大江戸線風）: 新宿西口 - 都庁前 - 練馬（2系統に分かれ、都庁前で乗換が必要）
 * - Odakyu.Odawara（小田急）: 新宿 - 小田原 …有料特急(Odakyu.LimitedExpress)のみ運行 -> 路線ごと除外される
 *
 * ■ 乗換グループ
 * - 新宿: 山手線新宿・中央線新宿（station-groups）、副都心線の新宿三丁目（名前が違う）、大江戸線の新宿西口
 * - 東京: 山手線と中央線（中央線側の alternate で統合）
 * - 渋谷: 副都心線と東横線 / 横浜: 東横線とみなとみらい線
 *
 * ■ 列車（時刻は分単位。= 秒は60の倍数）
 * - 山手線: 内回り in1（東京06:00発、一周50分=3000秒）と遅い in2（55分）、外回り out1（一周50分）、
 *   内回りの途中までの区間列車 part（東京→上野12分。環状の同区間600秒より遅いので刈り込まれる）
 * - 中央線: C1 東京06:05→新宿06:19（840秒）、C2 深夜の日またぎ 23:55→00:10（900秒、同じ系列で遅い）
 * - 直通: F1（副都心線 池袋→渋谷）→ T1（東横線 渋谷→横浜）→ M1（みなとみらい線 横浜→元町・中華街）
 *   F1 池袋07:00発/新宿三丁目07:08着09発/渋谷07:15着、T1 渋谷07:17発/代官山07:20着20発/横浜07:45着、
 *   M1 横浜07:47発/元町・中華街07:55着 => 運用累積: [0, 540, 900, 1020, 1200, 2700, 2820, 3300]
 *   区間: 副都心線 540,360 / 直通リンク 120 / 東横線 180,1500 / 直通リンク 120 / みなとみらい線 480
 * - 副都心線: F2 池袋→渋谷 840秒（直通運用の同区間 900秒より速いので残る）、
 *   F3 深夜の日またぎ 渋谷23:55→新宿三丁目00:03→池袋00:10（逆方向）
 * - 東横線: T2 平日 渋谷→横浜 1500秒（急行）と T2sat 土休日 1320秒（同系列 -> 最速の1320秒を採用）、
 *   T3 各停 渋谷→代官山→横浜 2400秒（直通運用の同区間 1680秒より遅いので刈り込まれる）
 * - みなとみらい線: M2 横浜→元町・中華街 480秒（直通運用の同区間 480秒以下 -> 刈り込まれる）
 * - 大江戸線: O1 新宿西口→都庁前 120秒、O2 都庁前→練馬 600秒
 * - 小田急 L1 特急（有料）: 除外される
 */

const TYPES = [
  'JR-East.Local',
  'TokyoMetro.Local',
  'Tokyu.Local',
  'Tokyu.Express',
  'Minatomirai.Local',
  'Toei.Local',
  'Odakyu.LimitedExpress',
  'Odakyu.Local',
];

const NAMES: Record<string, [string, string]> = {
  Tokyo: ['東京', 'Tokyo'],
  Ueno: ['上野', 'Ueno'],
  Shinjuku: ['新宿', 'Shinjuku'],
  Shinagawa: ['品川', 'Shinagawa'],
  Ikebukuro: ['池袋', 'Ikebukuro'],
  Shinjuku3: ['新宿三丁目', 'Shinjuku-sanchome'],
  Shibuya: ['渋谷', 'Shibuya'],
  Daikanyama: ['代官山', 'Daikanyama'],
  Yokohama: ['横浜', 'Yokohama'],
  Motomachi: ['元町・中華街', 'Motomachi-Chukagai'],
  ShinjukuNishiguchi: ['新宿西口', 'Shinjuku-nishiguchi'],
  Tochomae: ['都庁前', 'Tochomae'],
  Nerima: ['練馬', 'Nerima'],
  Odawara: ['小田原', 'Odawara'],
};

function station(
  railway: string,
  key: string,
  lon: number,
  lat: number,
  extra: Partial<Mt3dStation> = {}
): Mt3dStation {
  const [ja, en] = NAMES[key];
  return { id: `${railway}.${key}`, railway, coord: [lon, lat], title: { ja, en }, ...extra };
}

/** [駅キー, 到着, 出発] で列車を作る。id は `${railway}.${no}.${calendar}`。 */
function train(
  railway: string,
  no: string,
  calendar: 'Weekday' | 'SaturdayHoliday',
  type: string,
  direction: string,
  stops: [string, string | null, string | null][],
  links: { nt?: string[]; pt?: string[] } = {}
): Mt3dTrain {
  return {
    id: `${railway}.${no}.${calendar}`,
    r: railway,
    y: type,
    d: direction,
    tt: stops.map(([key, a, d]) => ({
      s: `${railway}.${key}`,
      ...(a ? { a } : {}),
      ...(d ? { d } : {}),
    })),
    ...(links.nt ? { nt: links.nt } : {}),
    ...(links.pt ? { pt: links.pt } : {}),
  };
}

const YAMA = 'JR-East.Yamanote';
const CHUO = 'JR-East.Chuo';
const FUKU = 'TokyoMetro.Fukutoshin';
const TOYO = 'Tokyu.Toyoko';
const MINA = 'Minatomirai.Minatomirai';
const OEDO = 'Toei.Oedo';
const ODAK = 'Odakyu.Odawara';

export function miniMt3dInput(): Mt3dInput {
  const railways = [
    {
      id: YAMA,
      title: { ja: '山手線', en: 'Yamanote Line' },
      stations: [`${YAMA}.Tokyo`, `${YAMA}.Ueno`, `${YAMA}.Shinjuku`, `${YAMA}.Shinagawa`, `${YAMA}.Tokyo`],
      color: '#9ACD32',
    },
    {
      id: CHUO,
      title: { ja: '中央線', en: 'Chuo Line' },
      stations: [`${CHUO}.Tokyo`, `${CHUO}.Shinjuku`],
      color: '#F15A22',
    },
    {
      id: FUKU,
      title: { ja: '副都心線', en: 'Fukutoshin Line' },
      stations: [`${FUKU}.Ikebukuro`, `${FUKU}.Shinjuku3`, `${FUKU}.Shibuya`],
      color: '#9C5E31',
    },
    {
      id: TOYO,
      title: { ja: '東横線', en: 'Toyoko Line' },
      stations: [`${TOYO}.Shibuya`, `${TOYO}.Daikanyama`, `${TOYO}.Yokohama`],
      color: '#DA0442',
    },
    {
      id: MINA,
      title: { ja: 'みなとみらい線', en: 'Minatomirai Line' },
      stations: [`${MINA}.Yokohama`, `${MINA}.Motomachi`],
      color: '#009BBF',
    },
    {
      id: OEDO,
      title: { ja: '大江戸線', en: 'Oedo Line' },
      stations: [`${OEDO}.ShinjukuNishiguchi`, `${OEDO}.Tochomae`, `${OEDO}.Nerima`],
      color: '#B6007A',
    },
    {
      id: ODAK,
      title: { ja: '小田原線', en: 'Odawara Line' },
      stations: [`${ODAK}.Shinjuku`, `${ODAK}.Odawara`],
      color: '#0066C0',
    },
  ];

  const stations: Mt3dStation[] = [
    station(YAMA, 'Tokyo', 139.7671, 35.6812),
    station(YAMA, 'Ueno', 139.7774, 35.7141),
    station(YAMA, 'Shinjuku', 139.7005, 35.6896),
    station(YAMA, 'Shinagawa', 139.7387, 35.6285),
    // 中央線の東京は station-groups に載せず alternate だけで山手線の東京と統合される
    station(CHUO, 'Tokyo', 139.7671, 35.6812, { alternate: `${YAMA}.Tokyo` }),
    station(CHUO, 'Shinjuku', 139.7005, 35.6896),
    station(FUKU, 'Ikebukuro', 139.7109, 35.7295),
    station(FUKU, 'Shinjuku3', 139.7063, 35.6909),
    station(FUKU, 'Shibuya', 139.7016, 35.6591),
    station(TOYO, 'Shibuya', 139.7016, 35.6591),
    station(TOYO, 'Daikanyama', 139.7031, 35.6486),
    station(TOYO, 'Yokohama', 139.6222, 35.4659),
    station(MINA, 'Yokohama', 139.6222, 35.4659),
    station(MINA, 'Motomachi', 139.65, 35.4423),
    station(OEDO, 'ShinjukuNishiguchi', 139.6973, 35.6934),
    station(OEDO, 'Tochomae', 139.6917, 35.6896),
    station(OEDO, 'Nerima', 139.654, 35.7377),
    station(ODAK, 'Shinjuku', 139.6993, 35.6909),
    station(ODAK, 'Odawara', 139.155, 35.2563),
    // 路線・座標のない駅レコード（無視される）
    { id: 'Ghost.Station', title: { ja: '幽霊駅', en: 'Ghost' } },
  ];

  const stationGroups: string[][][] = [
    [
      [`${YAMA}.Shinjuku`, `${CHUO}.Shinjuku`],
      [`${FUKU}.Shinjuku3`],
      [`${OEDO}.ShinjukuNishiguchi`, `${ODAK}.Shinjuku`],
    ],
    [[`${FUKU}.Shibuya`], [`${TOYO}.Shibuya`]],
    [[`${TOYO}.Yokohama`], [`${MINA}.Yokohama`]],
  ];

  const W = 'Weekday';
  const S = 'SaturdayHoliday';
  const trains: Mt3dTrain[] = [
    // 山手線
    train(YAMA, 'in1', W, 'JR-East.Local', 'InnerLoop', [
      ['Tokyo', null, '06:00'],
      ['Ueno', null, '06:10'],
      ['Shinjuku', null, '06:25'],
      ['Shinagawa', null, '06:40'],
      ['Tokyo', '06:50', null],
    ]),
    train(YAMA, 'in2', W, 'JR-East.Local', 'InnerLoop', [
      ['Tokyo', null, '07:00'],
      ['Ueno', null, '07:12'],
      ['Shinjuku', null, '07:28'],
      ['Shinagawa', null, '07:45'],
      ['Tokyo', '07:55', null],
    ]),
    train(YAMA, 'out1', W, 'JR-East.Local', 'OuterLoop', [
      ['Tokyo', null, '06:00'],
      ['Shinagawa', null, '06:10'],
      ['Shinjuku', null, '06:25'],
      ['Ueno', null, '06:40'],
      ['Tokyo', '06:50', null],
    ]),
    train(YAMA, 'part', W, 'JR-East.Local', 'InnerLoop', [
      ['Tokyo', null, '08:00'],
      ['Ueno', '08:12', null],
    ]),
    // 中央線
    train(CHUO, 'C1', W, 'JR-East.Local', 'Inbound', [
      ['Tokyo', null, '06:05'],
      ['Shinjuku', '06:19', null],
    ]),
    train(CHUO, 'C2', W, 'JR-East.Local', 'Inbound', [
      ['Tokyo', null, '23:55'],
      ['Shinjuku', '00:10', null],
    ]),
    // 直通: 副都心線 -> 東横線 -> みなとみらい線
    train(
      FUKU,
      'F1',
      W,
      'TokyoMetro.Local',
      'Down',
      [
        ['Ikebukuro', null, '07:00'],
        ['Shinjuku3', '07:08', '07:09'],
        ['Shibuya', '07:15', null],
      ],
      { nt: [`${TOYO}.T1.${W}`] }
    ),
    train(
      TOYO,
      'T1',
      W,
      'Tokyu.Local',
      'Down',
      [
        ['Shibuya', null, '07:17'],
        ['Daikanyama', '07:20', '07:20'],
        ['Yokohama', '07:45', null],
      ],
      { pt: [`${FUKU}.F1.${W}`], nt: [`${MINA}.M1.${W}`] }
    ),
    train(
      MINA,
      'M1',
      W,
      'Minatomirai.Local',
      'Down',
      [
        ['Yokohama', null, '07:47'],
        ['Motomachi', '07:55', null],
      ],
      { pt: [`${TOYO}.T1.${W}`] }
    ),
    // 副都心線の単独列車
    train(FUKU, 'F2', W, 'TokyoMetro.Local', 'Down', [
      ['Ikebukuro', null, '08:00'],
      ['Shinjuku3', '08:08', '08:08'],
      ['Shibuya', '08:14', null],
    ]),
    train(FUKU, 'F3', W, 'TokyoMetro.Local', 'Up', [
      ['Shibuya', null, '23:55'],
      ['Shinjuku3', '00:03', '00:03'],
      ['Ikebukuro', '00:10', null],
    ]),
    // 東横線・みなとみらい線の単独列車
    train(TOYO, 'T2', W, 'Tokyu.Express', 'Down', [
      ['Shibuya', null, '08:00'],
      ['Yokohama', '08:25', null],
    ]),
    train(TOYO, 'T2', S, 'Tokyu.Express', 'Down', [
      ['Shibuya', null, '09:00'],
      ['Yokohama', '09:22', null],
    ]),
    train(TOYO, 'T3', W, 'Tokyu.Local', 'Down', [
      ['Shibuya', null, '08:00'],
      ['Daikanyama', '08:05', '08:05'],
      ['Yokohama', '08:40', null],
    ]),
    train(MINA, 'M2', W, 'Minatomirai.Local', 'Down', [
      ['Yokohama', null, '08:30'],
      ['Motomachi', '08:38', null],
    ]),
    // 大江戸線
    train(OEDO, 'O1', W, 'Toei.Local', 'A', [
      ['ShinjukuNishiguchi', null, '06:00'],
      ['Tochomae', '06:02', null],
    ]),
    train(OEDO, 'O2', W, 'Toei.Local', 'A', [
      ['Tochomae', null, '06:10'],
      ['Nerima', '06:20', null],
    ]),
    // 小田急（有料特急のみ）
    train(ODAK, 'L1', W, 'Odakyu.LimitedExpress', 'Down', [
      ['Shinjuku', null, '06:00'],
      ['Odawara', '07:20', null],
    ]),
  ];

  return {
    railways,
    stations,
    stationGroups,
    trainTypes: TYPES.map((id) => ({ id, title: { ja: id } })),
    trains,
  };
}

/** miniMt3dInput() から構築した Network。 */
export function miniNetwork(): Network {
  return buildMt3dNetwork(miniMt3dInput()).network;
}

/** 路線名から line index を探す（テスト用）。 */
export function findLine(network: Network, name: string): number {
  const idx = network.lines.findIndex((l) => l.name === name);
  if (idx === -1) throw new Error(`line not found: ${name}`);
  return idx;
}

/** 路線名と駅名から駅レコードの station index を探す（テスト用）。 */
export function findStation(network: Network, lineName: string, stationName: string): number {
  const line = findLine(network, lineName);
  const idx = network.stations.findIndex((s) => s.line === line && s.name === stationName);
  if (idx === -1) throw new Error(`station not found: ${lineName} ${stationName}`);
  return idx;
}
