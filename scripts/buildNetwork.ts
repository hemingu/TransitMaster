import { parseCsv, parseGtfsTime } from './gtfsCsv.ts';
import type { FeedInfo, Line, Network, Pattern, Station } from '../src/lib/types.ts';

export interface GtfsFeed {
  name: string;
  files: Map<string, string>;
}

export interface BuildNetworkResult {
  network: Network;
  transferGroupLog: string[];
}

const TRANSFER_SEC = 180;
const TRANSFER_DISTANCE_M = 300;

function readCsv(feed: GtfsFeed, fileName: string): Record<string, string>[] {
  const text = feed.files.get(fileName);
  if (text === undefined) return [];
  return parseCsv(text);
}

/** NFKC 正規化・空白除去・末尾の「駅」除去で駅名を正規化する */
function normalizeStationName(name: string): string {
  let n = name.normalize('NFKC');
  n = n.replace(/\s+/g, '');
  n = n.replace(/駅$/u, '');
  return n;
}

/** ハバーシン距離（メートル） */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
    if (ra !== rb) this.parent[ra] = rb;
  }
}

interface StopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type?: string;
  parent_station?: string;
}

interface StationBuildInfo {
  key: string; // feed:representativeStopId
  station: Station;
  stopIds: Set<string>; // このフィード内でこの駅に属する生の stop_id 群（子ホーム含む）
}

/**
 * GTFS フィード群から Network（駅・路線・時刻表・乗換グループ・運賃）を構築する。
 * fs には依存しない純粋関数（テストから直接呼べる）。
 */
export function buildNetwork(feeds: GtfsFeed[]): BuildNetworkResult {
  const stations: Station[] = [];
  const stationIndexByKey = new Map<string, number>(); // "feed:stopId(rawまたは親)" -> station index
  const rawStopToStationIndex = new Map<string, number>(); // "feed:rawStopId" -> station index (子も含む全stop)

  const feedInfos: FeedInfo[] = [];

  // ---- 駅の構築 ----
  for (const feed of feeds) {
    const stopRows = readCsv(feed, 'stops.txt') as unknown as StopRow[];

    // 親駅（location_type=1）を先に登録
    const parentByStopId = new Map<string, StopRow>();
    for (const row of stopRows) {
      if (row.location_type === '1') {
        parentByStopId.set(row.stop_id, row);
      }
    }

    // 代表 stop（親、または親を持たない stop）ごとに Station を作る
    const representativeIndex = new Map<string, number>(); // representative stop_id -> station index

    const ensureStation = (repRow: StopRow): number => {
      const key = `${feed.name}:${repRow.stop_id}`;
      const existing = representativeIndex.get(repRow.stop_id);
      if (existing !== undefined) return existing;
      const idx = stations.length;
      stations.push({
        name: repRow.stop_name,
        lat: parseFloat(repRow.stop_lat),
        lon: parseFloat(repRow.stop_lon),
        group: -1, // 後で割り当て
        feed: feed.name,
      });
      representativeIndex.set(repRow.stop_id, idx);
      stationIndexByKey.set(key, idx);
      return idx;
    };

    for (const row of stopRows) {
      if (row.location_type === '1') {
        // 親駅自身
        const idx = ensureStation(row);
        rawStopToStationIndex.set(`${feed.name}:${row.stop_id}`, idx);
        continue;
      }
      if (row.parent_station && parentByStopId.has(row.parent_station)) {
        const parentRow = parentByStopId.get(row.parent_station)!;
        const idx = ensureStation(parentRow);
        rawStopToStationIndex.set(`${feed.name}:${row.stop_id}`, idx);
        continue;
      }
      // 親を持たない通常の stop はそれ自身が駅
      const idx = ensureStation(row);
      rawStopToStationIndex.set(`${feed.name}:${row.stop_id}`, idx);
    }

    // fareAvailable: fare_attributes.txt が存在し中身が空でない
    const fareAttrRows = readCsv(feed, 'fare_attributes.txt');
    feedInfos.push({ name: feed.name, fareAvailable: fareAttrRows.length > 0 });
  }

  // ---- 乗換グループ (Union-Find) ----
  const uf = new UnionFind(stations.length);

  // (a) transfers.txt
  for (const feed of feeds) {
    const transferRows = readCsv(feed, 'transfers.txt');
    for (const row of transferRows) {
      const fromStopId = row.from_stop_id;
      const toStopId = row.to_stop_id;
      if (!fromStopId || !toStopId) continue;
      const fromIdx = rawStopToStationIndex.get(`${feed.name}:${fromStopId}`);
      const toIdx = rawStopToStationIndex.get(`${feed.name}:${toStopId}`);
      if (fromIdx !== undefined && toIdx !== undefined) {
        uf.union(fromIdx, toIdx);
      }
    }
  }

  // (b) フィードをまたぐ駅名正規化一致 + 距離 <= 300m
  const normNameGroups = new Map<string, number[]>();
  stations.forEach((s, idx) => {
    const norm = normalizeStationName(s.name);
    const arr = normNameGroups.get(norm) ?? [];
    arr.push(idx);
    normNameGroups.set(norm, arr);
  });
  for (const [, idxs] of normNameGroups) {
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const a = stations[idxs[i]];
        const b = stations[idxs[j]];
        if (a.feed === b.feed) continue; // 同一フィード内は名前一致だけでは統合しない
        const dist = haversineMeters(a.lat, a.lon, b.lat, b.lon);
        if (dist <= TRANSFER_DISTANCE_M) {
          uf.union(idxs[i], idxs[j]);
        }
      }
    }
  }

  // グループIDの割り当て（root index を安定した連番に変換）
  const rootToGroupId = new Map<number, number>();
  for (let i = 0; i < stations.length; i++) {
    const root = uf.find(i);
    let gid = rootToGroupId.get(root);
    if (gid === undefined) {
      gid = rootToGroupId.size;
      rootToGroupId.set(root, gid);
    }
    stations[i].group = gid;
  }

  // transferGroupLog: 2駅以上のグループのみ
  const groupMembers = new Map<number, number[]>();
  stations.forEach((s, idx) => {
    const arr = groupMembers.get(s.group) ?? [];
    arr.push(idx);
    groupMembers.set(s.group, arr);
  });
  const transferGroupLog: string[] = [];
  for (const [gid, members] of [...groupMembers.entries()].sort((a, b) => a[0] - b[0])) {
    if (members.length < 2) continue;
    const groupName = stations[members[0]].name;
    const list = members.map((idx) => `${stations[idx].name}(${stations[idx].feed})`).join(', ');
    transferGroupLog.push(`${groupName}: ${list}`);
  }

  // ---- 路線・時刻表の構築 ----
  const lines: Line[] = [];

  for (const feed of feeds) {
    const agencyRows = readCsv(feed, 'agency.txt');
    const agencyNameById = new Map<string, string>();
    for (const row of agencyRows) {
      if (row.agency_id) agencyNameById.set(row.agency_id, row.agency_name);
    }
    const defaultAgencyName = agencyRows[0]?.agency_name ?? '';

    const routeRows = readCsv(feed, 'routes.txt');
    const routeById = new Map<string, Record<string, string>>();
    for (const row of routeRows) {
      routeById.set(row.route_id, row);
    }

    // calendar.txt: 月曜=1 の service のみ採用（代表平日）
    const calendarRows = readCsv(feed, 'calendar.txt');
    const weekdayServiceIds = new Set<string>();
    for (const row of calendarRows) {
      if (row.monday === '1') {
        weekdayServiceIds.add(row.service_id);
      }
    }

    // trips.txt: service フィルタ、route_id ごとにグルーピング
    const tripRows = readCsv(feed, 'trips.txt');
    const tripsByRoute = new Map<string, Record<string, string>[]>();
    const validTripIds = new Set<string>();
    for (const row of tripRows) {
      if (!weekdayServiceIds.has(row.service_id)) continue;
      const arr = tripsByRoute.get(row.route_id) ?? [];
      arr.push(row);
      tripsByRoute.set(row.route_id, arr);
      validTripIds.add(row.trip_id);
    }

    // stop_times.txt: trip_id ごとに集める（有効なtripのみ）
    const stopTimeRows = readCsv(feed, 'stop_times.txt');
    const stopTimesByTrip = new Map<string, Record<string, string>[]>();
    for (const row of stopTimeRows) {
      if (!validTripIds.has(row.trip_id)) continue;
      const arr = stopTimesByTrip.get(row.trip_id) ?? [];
      arr.push(row);
      stopTimesByTrip.set(row.trip_id, arr);
    }
    for (const arr of stopTimesByTrip.values()) {
      arr.sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
    }

    // fare_rules.txt / fare_attributes.txt
    const fareAttrRows = readCsv(feed, 'fare_attributes.txt');
    const fareAttrById = new Map<string, Record<string, string>>();
    for (const row of fareAttrRows) {
      fareAttrById.set(row.fare_id, row);
    }
    const fareRuleRows = readCsv(feed, 'fare_rules.txt');
    const fareIdByRoute = new Map<string, string>();
    for (const row of fareRuleRows) {
      if (row.route_id) {
        fareIdByRoute.set(row.route_id, row.fare_id);
      }
    }

    for (const [routeId, routeTrips] of tripsByRoute) {
      const routeRow = routeById.get(routeId);
      if (!routeRow) continue;
      const lineName = routeRow.route_long_name || routeRow.route_short_name || routeId;
      const company = routeRow.agency_id
        ? agencyNameById.get(routeRow.agency_id) ?? defaultAgencyName
        : defaultAgencyName;

      // 同一停車駅列ごとに Pattern をまとめる
      const patternByStopKey = new Map<string, Pattern>();

      for (const tripRow of routeTrips) {
        const stopTimes = stopTimesByTrip.get(tripRow.trip_id);
        if (!stopTimes || stopTimes.length === 0) continue;

        const stopIndices: number[] = [];
        const times: number[] = [];
        let valid = true;
        for (const st of stopTimes) {
          const stationIdx = rawStopToStationIndex.get(`${feed.name}:${st.stop_id}`);
          if (stationIdx === undefined) {
            valid = false;
            break;
          }
          stopIndices.push(stationIdx);
          const timeStr = st.departure_time || st.arrival_time;
          if (!timeStr) {
            valid = false;
            break;
          }
          times.push(parseGtfsTime(timeStr));
        }
        if (!valid) continue;

        const stopKey = stopIndices.join(',');
        let pattern = patternByStopKey.get(stopKey);
        if (!pattern) {
          pattern = { stops: stopIndices, trips: [] };
          patternByStopKey.set(stopKey, pattern);
        }
        pattern.trips.push(times);
      }

      // trips を先頭時刻順にソート
      const patterns = [...patternByStopKey.values()];
      for (const pattern of patterns) {
        pattern.trips.sort((a, b) => a[0] - b[0]);
      }

      if (patterns.length === 0) continue;

      // 運賃決定
      let fare: number | null = null;
      const fareId = fareIdByRoute.get(routeId);
      if (fareId && fareAttrById.has(fareId)) {
        const price = parseFloat(fareAttrById.get(fareId)!.price);
        if (!Number.isNaN(price)) fare = Math.round(price);
      } else if (fareIdByRoute.size === 0 && fareAttrById.size === 1) {
        // route_id 指定のruleが一つもなく、フィードに fare_attribute が1つだけなら全路線に適用
        const only = [...fareAttrById.values()][0];
        const price = parseFloat(only.price);
        if (!Number.isNaN(price)) fare = Math.round(price);
      }

      lines.push({
        name: lineName,
        company,
        feed: feed.name,
        fare,
        patterns,
      });
    }
  }

  const network: Network = {
    stations,
    lines,
    feeds: feedInfos,
    transferSec: TRANSFER_SEC,
  };

  return { network, transferGroupLog };
}
