import { describe, expect, it } from 'vitest';
import { getNetworkIndex, nextNode } from '../src/lib/networkIndex.ts';
import { findLine, findStation, miniNetwork } from './fixtures/miniMt3d.ts';

describe('getNetworkIndex', () => {
  const network = miniNetwork();
  const index = getNetworkIndex(network);

  it('groupMembers: 同一groupの駅indexを正しく束ねる', () => {
    const shinjuku = network.stations[findStation(network, '山手線', '新宿')].group;
    const members = index.groupMembers.get(shinjuku)!;
    // 山手線・中央線・副都心線(新宿三丁目)・大江戸線(新宿西口)
    expect(new Set(members.map((m) => network.stations[m].line))).toEqual(
      new Set([
        findLine(network, '山手線'),
        findLine(network, '中央線'),
        findLine(network, '副都心線'),
        findLine(network, '大江戸線'),
      ])
    );
    expect(members).toHaveLength(4);

    const ueno = network.stations[findStation(network, '山手線', '上野')].group;
    expect(index.groupMembers.get(ueno)).toHaveLength(1);
  });

  it('ノード採番: 総ノード数 = 非環状は停車駅数、環状は末尾の再掲を除いた実長の合計', () => {
    let expected = 0;
    network.patterns.forEach((p, i) => {
      const len = index.isRing[i] ? p.stops.length - 1 : p.stops.length;
      expected += len;
      expect(index.patOffset[i + 1] - index.patOffset[i]).toBe(len);
    });
    expect(index.nodeCount).toBe(expected);
    expect(index.patOffset[network.patterns.length]).toBe(expected);
  });

  it('isRing: 山手線の2パターン（内回り・外回り）のみ環状', () => {
    const ringPatterns = network.patterns.filter((_, i) => index.isRing[i]);
    expect(ringPatterns).toHaveLength(2);
    const yamanote = findLine(network, '山手線');
    for (const p of ringPatterns) expect(p.segLine.every((l) => l === yamanote)).toBe(true);
  });

  it('ノードの逆引き: 環状パターンの始点駅は二重登録されない', () => {
    const tokyo = findStation(network, '山手線', '東京');
    const nodes: number[] = [];
    for (let k = index.stationNodeStart[tokyo]; k < index.stationNodeStart[tokyo + 1]; k++) {
      nodes.push(index.stationNodeList[k]);
    }
    // 山手線の環状2パターンに1回ずつ（中央線の東京は別レコード）
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(index.nodePos[node]).toBe(0);
      expect(index.nodeStation[node]).toBe(tokyo);
    }
  });

  it('nextNode: 非環状の終端は -1、環状の終端は先頭へ巡回する', () => {
    for (let p = 0; p < network.patterns.length; p++) {
      const first = index.patOffset[p];
      const last = index.patOffset[p + 1] - 1;
      expect(nextNode(index, last)).toBe(index.isRing[p] ? first : -1);
      if (last > first) expect(nextNode(index, first)).toBe(first + 1);
    }
  });

  it('lineGroups / lineStations: 路線の駅レコードと所属グループ', () => {
    const toyoko = findLine(network, '東横線');
    expect(index.lineStations[toyoko]).toHaveLength(3);
    expect(index.lineGroups[toyoko].size).toBe(3);
    const yamanote = findLine(network, '山手線');
    expect(index.lineGroups[yamanote].size).toBe(4);
  });

  it('lineAdjacency: 路線の区間だけで有向につながる（直通リンクは含まない）', () => {
    const toyoko = findLine(network, '東横線');
    const adj = index.lineAdjacency[toyoko];
    const shibuya = findStation(network, '東横線', '渋谷');
    const daikanyama = findStation(network, '東横線', '代官山');
    const yokohama = findStation(network, '東横線', '横浜');
    expect(adj.get(shibuya)).toEqual(expect.arrayContaining([daikanyama, yokohama]));
    expect(adj.get(daikanyama)).toEqual([yokohama]);
    // 逆方向の区間はない（有向）
    expect(adj.get(yokohama)).toBeUndefined();

    // 副都心線の渋谷から、直通リンク先の東横線の渋谷へは（路線の区間ではないので）辿れない
    const fukuShibuya = findStation(network, '副都心線', '渋谷');
    const fukuAdj = index.lineAdjacency[findLine(network, '副都心線')];
    expect(fukuAdj.get(fukuShibuya)).not.toContain(shibuya);
    for (const targets of fukuAdj.values()) {
      for (const t of targets) expect(network.stations[t].line).toBe(findLine(network, '副都心線'));
    }
  });

  it('WeakMapメモ化: 同一Network参照に対して同一のNetworkIndexオブジェクトを返す', () => {
    expect(getNetworkIndex(network)).toBe(index);
    expect(getNetworkIndex(miniNetwork())).not.toBe(index);
  });
});
