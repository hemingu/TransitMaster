import type { GtfsFeed } from '../../scripts/buildNetwork.ts';

/**
 * テスト用のミニGTFSフィード（jr / metro）を in-memory で生成する。
 *
 * jr フィード:
 *  - 山手線: 東京(親子構造) - 神田 - 秋葉原 - 上野 - 池袋（各駅間3分）
 *  - 中央線: 御茶ノ水 - 四ツ谷 - 新宿（御茶ノ水→四ツ谷3分、四ツ谷→新宿3分）
 *  - calendar: WD（平日）と HD（休日）の両方の trip を用意し、HD が除外されることを確認できるようにする
 *  - fare_rules: 山手線=200円、中央線=160円
 *
 * metro フィード:
 *  - 丸ノ内線: 池袋 - 御茶ノ水 - 大手町 - 東京 - 四ツ谷 - 新宿
 *    区間所要: 池袋→御茶ノ水12分, →大手町3分, →東京2分, →四ツ谷10分, →新宿9分
 *    (東京→新宿 直通19分)
 *  - calendar: WD のみ
 *  - fare: fare_attribute 1つ（170円、route_id指定ruleなし）を全路線に適用
 *  - 駅名は jr と同名の駅を 300m 以内の座標にして、フィード間の乗換統合を発生させる
 *
 * 実際のダイヤは Tokyo -> Shinjuku で
 *   丸ノ内線直通: 19分・乗換0・170円
 *   丸ノ内線(Tokyo->Ochanomizu, 5分) + 乗換180秒 + 中央線(Ochanomizu->Shinjuku, 6分): 17分・乗換1・330円
 * となるよう調整済み（乗換ルートの方が所要時間が短い）。
 */

const AGENCY_CSV_HEADER = 'agency_id,agency_name,agency_url,agency_timezone';

function buildAgencyCsv(id: string, name: string): string {
  return [AGENCY_CSV_HEADER, `${id},${name},https://example.com,Asia/Tokyo`].join('\n');
}

function buildCalendarCsv(): string {
  const header =
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date';
  const wd = 'WD,1,1,1,1,1,0,0,20260101,20261231';
  const hd = 'HD,0,0,0,0,0,1,1,20260101,20261231';
  return [header, wd, hd].join('\n');
}

interface StopDef {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  location_type?: string;
  parent_station?: string;
}

function buildStopsCsv(stops: StopDef[]): string {
  const header = 'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station';
  const lines = stops.map((s) =>
    [
      s.stop_id,
      s.stop_name,
      String(s.stop_lat),
      String(s.stop_lon),
      s.location_type ?? '',
      s.parent_station ?? '',
    ].join(',')
  );
  return [header, ...lines].join('\n');
}

interface RouteDef {
  route_id: string;
  agency_id: string;
  route_long_name: string;
}

function buildRoutesCsv(routes: RouteDef[]): string {
  const header = 'route_id,agency_id,route_short_name,route_long_name,route_type';
  const lines = routes.map((r) => [r.route_id, r.agency_id, '', r.route_long_name, '1'].join(','));
  return [header, ...lines].join('\n');
}

function buildFareAttributesCsv(fares: { fare_id: string; price: number }[]): string {
  const header = 'fare_id,price,currency_type,payment_method,transfers';
  const lines = fares.map((f) => [f.fare_id, String(f.price), 'JPY', '0', ''].join(','));
  return [header, ...lines].join('\n');
}

function buildFareRulesCsv(rules: { fare_id: string; route_id: string }[]): string {
  const header = 'fare_id,route_id';
  const lines = rules.map((r) => [r.fare_id, r.route_id].join(','));
  return [header, ...lines].join('\n');
}

/** HH:MM:SS 形式の文字列を作る（秒からの逆変換） */
function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

interface TripGenSpec {
  routeId: string;
  serviceId: string;
  directionSuffix: string; // trip_id の一意性確保用
  stopIds: string[]; // 停車順
  cumulativeSecFromFirst: number[]; // 各停車駅の、始発からの経過秒（stopIdsと同じ長さ、先頭は0）
  startTimesSec: number[]; // 各tripの始発時刻（秒）
}

interface GeneratedTrips {
  tripsCsvRows: string[];
  stopTimesCsvRows: string[];
}

/** 等間隔ダイヤの trips.txt / stop_times.txt 行を量産する */
function generateTrips(spec: TripGenSpec): GeneratedTrips {
  const tripsCsvRows: string[] = [];
  const stopTimesCsvRows: string[] = [];

  spec.startTimesSec.forEach((startSec, tripIdx) => {
    const tripId = `${spec.routeId}_${spec.directionSuffix}_${tripIdx}`;
    tripsCsvRows.push([spec.routeId, spec.serviceId, tripId].join(','));

    spec.stopIds.forEach((stopId, stopIdx) => {
      const timeSec = startSec + spec.cumulativeSecFromFirst[stopIdx];
      const timeStr = formatTime(timeSec);
      stopTimesCsvRows.push(
        [tripId, timeStr, timeStr, stopId, String(stopIdx + 1)].join(',')
      );
    });
  });

  return { tripsCsvRows, stopTimesCsvRows };
}

/** 8:00 から 10:00 まで10分間隔の始発時刻（秒）配列 */
function tenMinuteStarts(): number[] {
  const starts: number[] = [];
  for (let t = 8 * 3600; t <= 10 * 3600; t += 10 * 60) {
    starts.push(t);
  }
  return starts;
}

/**
 * 累積時刻配列（区間所要は不等な場合がある）を反転方向用に組み直す。
 * 例: 区間所要が [12,3,2,10,9] (5停留所) なら、逆順の区間所要は [9,10,2,3,12] になる。
 */
function reverseCumulative(cumulative: number[]): number[] {
  const segments: number[] = [];
  for (let i = 1; i < cumulative.length; i++) {
    segments.push(cumulative[i] - cumulative[i - 1]);
  }
  segments.reverse();
  const revCumulative = [0];
  let acc = 0;
  for (const seg of segments) {
    acc += seg;
    revCumulative.push(acc);
  }
  return revCumulative;
}

export function miniGtfsFeeds(): GtfsFeed[] {
  // ===================== jr フィード =====================
  const jrAgencyCsv = buildAgencyCsv('JR', 'JRテスト');

  // 山手線: 東京(親子構造) - 神田 - 秋葉原 - 上野 - 池袋 （各駅間3分）
  const yamanoteStopIds = ['TOKYO_P', 'KANDA', 'AKIHABARA', 'UENO', 'IKEBUKURO_JR'];
  const yamanoteCumulative = [0, 3 * 60, 6 * 60, 9 * 60, 12 * 60];

  // 中央線: 御茶ノ水 - 四ツ谷 - 新宿 （3分, 3分）
  const chuoStopIds = ['OCHANOMIZU_JR', 'YOTSUYA_JR', 'SHINJUKU_JR'];
  const chuoCumulative = [0, 3 * 60, 6 * 60];

  const jrStops: StopDef[] = [
    // 東京: 親駅 + 子ホーム（パーサテスト用）
    { stop_id: 'TOKYO_P', stop_name: '東京', stop_lat: 35.681, stop_lon: 139.767, location_type: '1' },
    {
      stop_id: 'TOKYO_PLATFORM1',
      stop_name: '東京 1番線',
      stop_lat: 35.6811,
      stop_lon: 139.7671,
      parent_station: 'TOKYO_P',
    },
    { stop_id: 'KANDA', stop_name: '神田', stop_lat: 35.6917, stop_lon: 139.7708 },
    { stop_id: 'AKIHABARA', stop_name: '秋葉原', stop_lat: 35.6984, stop_lon: 139.7731 },
    { stop_id: 'UENO', stop_name: '上野', stop_lat: 35.7138, stop_lon: 139.777 },
    { stop_id: 'IKEBUKURO_JR', stop_name: '池袋', stop_lat: 35.7289, stop_lon: 139.71 },
    { stop_id: 'OCHANOMIZU_JR', stop_name: '御茶ノ水', stop_lat: 35.6993, stop_lon: 139.7649 },
    { stop_id: 'YOTSUYA_JR', stop_name: '四ツ谷', stop_lat: 35.686, stop_lon: 139.73 },
    { stop_id: 'SHINJUKU_JR', stop_name: '新宿', stop_lat: 35.69, stop_lon: 139.7004 },
  ];

  const jrRoutes: RouteDef[] = [
    { route_id: 'YAMANOTE', agency_id: 'JR', route_long_name: '山手線' },
    { route_id: 'CHUO', agency_id: 'JR', route_long_name: '中央線' },
  ];

  const jrTripsRows: string[] = [];
  const jrStopTimesRows: string[] = [];

  const starts = tenMinuteStarts();

  // 山手線: 両方向、WD と HD 両方の trip を作る（HDが除外されることをテストで確認）
  for (const serviceId of ['WD', 'HD']) {
    // 東京 -> 池袋方向
    const fwd = generateTrips({
      routeId: 'YAMANOTE',
      serviceId,
      directionSuffix: `${serviceId}_fwd`,
      stopIds: ['TOKYO_PLATFORM1', 'KANDA', 'AKIHABARA', 'UENO', 'IKEBUKURO_JR'],
      cumulativeSecFromFirst: yamanoteCumulative,
      startTimesSec: starts,
    });
    jrTripsRows.push(...fwd.tripsCsvRows);
    jrStopTimesRows.push(...fwd.stopTimesCsvRows);

    // 池袋 -> 東京方向
    const revStopIds = [...yamanoteStopIds].reverse();
    revStopIds[revStopIds.length - 1] = 'TOKYO_PLATFORM1'; // 子ホーム経由で終着
    const bwd = generateTrips({
      routeId: 'YAMANOTE',
      serviceId,
      directionSuffix: `${serviceId}_bwd`,
      stopIds: revStopIds,
      cumulativeSecFromFirst: reverseCumulative(yamanoteCumulative),
      startTimesSec: starts,
    });
    jrTripsRows.push(...bwd.tripsCsvRows);
    jrStopTimesRows.push(...bwd.stopTimesCsvRows);
  }

  // 中央線: 両方向、WD と HD
  for (const serviceId of ['WD', 'HD']) {
    const fwd = generateTrips({
      routeId: 'CHUO',
      serviceId,
      directionSuffix: `${serviceId}_fwd`,
      stopIds: chuoStopIds,
      cumulativeSecFromFirst: chuoCumulative,
      startTimesSec: starts,
    });
    jrTripsRows.push(...fwd.tripsCsvRows);
    jrStopTimesRows.push(...fwd.stopTimesCsvRows);

    const bwd = generateTrips({
      routeId: 'CHUO',
      serviceId,
      directionSuffix: `${serviceId}_bwd`,
      stopIds: [...chuoStopIds].reverse(),
      cumulativeSecFromFirst: reverseCumulative(chuoCumulative),
      startTimesSec: starts,
    });
    jrTripsRows.push(...bwd.tripsCsvRows);
    jrStopTimesRows.push(...bwd.stopTimesCsvRows);
  }

  const jrTripsCsv = ['route_id,service_id,trip_id', ...jrTripsRows].join('\n');
  const jrStopTimesCsv = [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    ...jrStopTimesRows,
  ].join('\n');

  const jrFareAttributesCsv = buildFareAttributesCsv([
    { fare_id: 'FARE_YAMANOTE', price: 200 },
    { fare_id: 'FARE_CHUO', price: 160 },
  ]);
  const jrFareRulesCsv = buildFareRulesCsv([
    { fare_id: 'FARE_YAMANOTE', route_id: 'YAMANOTE' },
    { fare_id: 'FARE_CHUO', route_id: 'CHUO' },
  ]);

  const jrFiles = new Map<string, string>([
    ['agency.txt', jrAgencyCsv],
    ['calendar.txt', buildCalendarCsv()],
    ['stops.txt', buildStopsCsv(jrStops)],
    ['routes.txt', buildRoutesCsv(jrRoutes)],
    ['trips.txt', jrTripsCsv],
    ['stop_times.txt', jrStopTimesCsv],
    ['fare_attributes.txt', jrFareAttributesCsv],
    ['fare_rules.txt', jrFareRulesCsv],
  ]);

  // ===================== metro フィード =====================
  const metroAgencyCsv = buildAgencyCsv('METRO', 'メトロテスト');

  // 丸ノ内線: 池袋 - 御茶ノ水 - 大手町 - 東京 - 四ツ谷 - 新宿
  // 区間所要: 池袋→御茶ノ水12分, →大手町3分, →東京2分, →四ツ谷10分, →新宿9分
  const marunouchiStopIds = [
    'IKEBUKURO_M',
    'OCHANOMIZU_M',
    'OTEMACHI_M',
    'TOKYO_M',
    'YOTSUYA_M',
    'SHINJUKU_M',
  ];
  const marunouchiCumulative = [
    0,
    12 * 60,
    (12 + 3) * 60,
    (12 + 3 + 2) * 60,
    (12 + 3 + 2 + 10) * 60,
    (12 + 3 + 2 + 10 + 9) * 60,
  ];

  // jr と同名駅を 300m 以内にずらした座標（緯度・経度をわずかにオフセット、300m未満に収める）
  const metroStops: StopDef[] = [
    { stop_id: 'IKEBUKURO_M', stop_name: '池袋', stop_lat: 35.7291, stop_lon: 139.7102 },
    { stop_id: 'OCHANOMIZU_M', stop_name: '御茶ノ水', stop_lat: 35.6995, stop_lon: 139.7651 },
    { stop_id: 'OTEMACHI_M', stop_name: '大手町', stop_lat: 35.6847, stop_lon: 139.766 },
    { stop_id: 'TOKYO_M', stop_name: '東京', stop_lat: 35.6812, stop_lon: 139.7671 },
    { stop_id: 'YOTSUYA_M', stop_name: '四ツ谷', stop_lat: 35.6862, stop_lon: 139.7302 },
    { stop_id: 'SHINJUKU_M', stop_name: '新宿', stop_lat: 35.6902, stop_lon: 139.7006 },
  ];

  const metroRoutes: RouteDef[] = [
    { route_id: 'MARUNOUCHI', agency_id: 'METRO', route_long_name: '丸ノ内線' },
  ];

  const metroTripsRows: string[] = [];
  const metroStopTimesRows: string[] = [];

  // 池袋 -> 新宿方向
  const mFwd = generateTrips({
    routeId: 'MARUNOUCHI',
    serviceId: 'WD',
    directionSuffix: 'fwd',
    stopIds: marunouchiStopIds,
    cumulativeSecFromFirst: marunouchiCumulative,
    startTimesSec: starts,
  });
  metroTripsRows.push(...mFwd.tripsCsvRows);
  metroStopTimesRows.push(...mFwd.stopTimesCsvRows);

  // 新宿 -> 池袋方向（Tokyo -> Ochanomizu の乗換検証に必要）
  const mBwd = generateTrips({
    routeId: 'MARUNOUCHI',
    serviceId: 'WD',
    directionSuffix: 'bwd',
    stopIds: [...marunouchiStopIds].reverse(),
    cumulativeSecFromFirst: reverseCumulative(marunouchiCumulative),
    startTimesSec: starts,
  });
  metroTripsRows.push(...mBwd.tripsCsvRows);
  metroStopTimesRows.push(...mBwd.stopTimesCsvRows);

  const metroTripsCsv = ['route_id,service_id,trip_id', ...metroTripsRows].join('\n');
  const metroStopTimesCsv = [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    ...metroStopTimesRows,
  ].join('\n');

  // fare_attribute 1つ（170円）を全路線に適用（route_id指定のruleなし）
  const metroFareAttributesCsv = buildFareAttributesCsv([{ fare_id: 'FARE_METRO', price: 170 }]);

  const metroFiles = new Map<string, string>([
    ['agency.txt', metroAgencyCsv],
    ['calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWD,1,1,1,1,1,0,0,20260101,20261231'],
    ['stops.txt', buildStopsCsv(metroStops)],
    ['routes.txt', buildRoutesCsv(metroRoutes)],
    ['trips.txt', metroTripsCsv],
    ['stop_times.txt', metroStopTimesCsv],
    ['fare_attributes.txt', metroFareAttributesCsv],
    // fare_rules.txt はあえて置かない（route_id指定ruleがないケースを再現）
  ]);

  return [
    { name: 'jr', files: jrFiles },
    { name: 'metro', files: metroFiles },
  ];
}
