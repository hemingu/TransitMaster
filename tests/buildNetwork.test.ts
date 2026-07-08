import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../scripts/buildNetwork.ts';
import { miniGtfsFeeds } from './fixtures/miniGtfs.ts';
import type { Network, Pattern } from '../src/lib/types.ts';

function findStationIndices(network: Network, name: string): number[] {
  return network.stations
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s.name === name)
    .map(({ idx }) => idx);
}

function findLine(network: Network, name: string, feed: string) {
  const line = network.lines.find((l) => l.name === name && l.feed === feed);
  if (!line) throw new Error(`line not found: ${name} (${feed})`);
  return line;
}

describe('buildNetwork', () => {
  const { network, transferGroupLog } = buildNetwork(miniGtfsFeeds());

  it('produces the expected number of stations', () => {
    // jr: 東京(親+子1つに集約), 神田, 秋葉原, 上野, 池袋, 御茶ノ水, 四ツ谷, 新宿 = 8駅
    // metro: 池袋, 御茶ノ水, 大手町, 東京, 四ツ谷, 新宿 = 6駅
    // 合計 14駅（乗換グループでの統合は Station 数自体は減らさない。名前が同じ駅でも feed違いは別Stationレコード）
    expect(network.stations.length).toBe(14);
  });

  it('produces the expected number of lines', () => {
    // 山手線・中央線（jr）、丸ノ内線（metro） = 3路線
    expect(network.lines.length).toBe(3);
  });

  it('groups Tokyo station across jr and metro feeds into the same transfer group', () => {
    const tokyoIndices = findStationIndices(network, '東京');
    expect(tokyoIndices.length).toBe(2); // jr(親に集約された1駅) + metro(1駅)

    const groups = new Set(tokyoIndices.map((idx) => network.stations[idx].group));
    expect(groups.size).toBe(1);

    const feeds = new Set(tokyoIndices.map((idx) => network.stations[idx].feed));
    expect(feeds).toEqual(new Set(['jr', 'metro']));
  });

  it('keeps Otemachi as a standalone group (metro only, no jr counterpart)', () => {
    const otemachiIndices = findStationIndices(network, '大手町');
    expect(otemachiIndices.length).toBe(1);

    const otemachiGroup = network.stations[otemachiIndices[0]].group;
    const groupMembers = network.stations.filter((s) => s.group === otemachiGroup);
    expect(groupMembers.length).toBe(1);
  });

  it('excludes weekend (HD) service trips, keeping only weekday (WD) trips', () => {
    const yamanote = findLine(network, '山手線', 'jr');
    // 各方向の始発時刻は 8:00~10:00 の10分間隔 = 13本。往復2方向 x 1パターンずつのはず。
    for (const pattern of yamanote.patterns) {
      expect(pattern.trips.length).toBe(13);
    }

    const chuo = findLine(network, '中央線', 'jr');
    for (const pattern of chuo.patterns) {
      expect(pattern.trips.length).toBe(13);
    }
  });

  it('sets fares correctly per line and marks fareAvailable per feed', () => {
    const yamanote = findLine(network, '山手線', 'jr');
    const chuo = findLine(network, '中央線', 'jr');
    const marunouchi = findLine(network, '丸ノ内線', 'metro');

    expect(yamanote.fare).toBe(200);
    expect(chuo.fare).toBe(160);
    expect(marunouchi.fare).toBe(170);

    const jrFeedInfo = network.feeds.find((f) => f.name === 'jr');
    const metroFeedInfo = network.feeds.find((f) => f.name === 'metro');
    expect(jrFeedInfo?.fareAvailable).toBe(true);
    expect(metroFeedInfo?.fareAvailable).toBe(true);
  });

  it('consolidates parent_station child stops into the parent station (no duplicate Tokyo-JR station)', () => {
    const tokyoJrIndices = network.stations
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.name === '東京' && s.feed === 'jr')
      .map(({ idx }) => idx);
    expect(tokyoJrIndices.length).toBe(1);
  });

  it('sorts trips within a pattern by departure time', () => {
    for (const line of network.lines) {
      for (const pattern of line.patterns) {
        for (let i = 1; i < pattern.trips.length; i++) {
          expect(pattern.trips[i][0]).toBeGreaterThanOrEqual(pattern.trips[i - 1][0]);
        }
      }
    }
  });

  it('has a Marunouchi pattern from Tokyo to Shinjuku direction with a 19-minute direct travel time', () => {
    const marunouchi = findLine(network, '丸ノ内線', 'metro');
    const tokyoIdx = findStationIndices(network, '東京').find(
      (idx) => network.stations[idx].feed === 'metro'
    )!;
    const shinjukuIdx = findStationIndices(network, '新宿').find(
      (idx) => network.stations[idx].feed === 'metro'
    )!;

    // Tokyo -> Shinjuku 方向のパターンを探す（stops配列にtokyoIdxが含まれ、shinjukuIdxがそれより後ろにある）
    const pattern = marunouchi.patterns.find((p: Pattern) => {
      const tIdx = p.stops.indexOf(tokyoIdx);
      const sIdx = p.stops.indexOf(shinjukuIdx);
      return tIdx !== -1 && sIdx !== -1 && tIdx < sIdx;
    });
    expect(pattern).toBeDefined();

    const tokyoPos = pattern!.stops.indexOf(tokyoIdx);
    const shinjukuPos = pattern!.stops.indexOf(shinjukuIdx);

    const trip = pattern!.trips[0];
    const durationSec = trip[shinjukuPos] - trip[tokyoPos];
    expect(durationSec).toBe(19 * 60);
  });

  it('logs the Tokyo transfer group in transferGroupLog', () => {
    const tokyoLogEntry = transferGroupLog.find((line) => line.startsWith('東京:'));
    expect(tokyoLogEntry).toBeDefined();
    expect(tokyoLogEntry).toContain('(jr)');
    expect(tokyoLogEntry).toContain('(metro)');
  });
});
