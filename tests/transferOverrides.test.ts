import { describe, expect, it } from 'vitest';
import { buildMt3dNetwork, type TransferGroupOverrides } from '../scripts/buildMt3dNetwork.ts';
import { generateQuestion } from '../src/lib/question.ts';
import { miniMt3dInput } from './fixtures/miniMt3d.ts';

function build(overrides: TransferGroupOverrides) {
  const input = miniMt3dInput();
  input.overrides = overrides;
  return buildMt3dNetwork(input).network;
}

const groupsOf = (net: ReturnType<typeof build>, name: string) =>
  new Set(net.stations.filter((s) => s.name === name).map((s) => s.group));

describe('乗換グループの手動調整（overrides）', () => {
  const base = build({});
  const baseGroupCount = new Set(base.stations.map((s) => s.group)).size;
  // フィクスチャの新宿グループ = 新宿 / 新宿三丁目 / 新宿西口
  const SHINJUKU = ['新宿', '新宿三丁目', '新宿西口'];

  it('split: 挙げた駅名ごとに別グループになる', () => {
    const net = build({ split: [SHINJUKU] });
    expect(new Set(net.stations.map((s) => s.group)).size).toBe(baseGroupCount + 2);
    const g = SHINJUKU.map((n) => [...groupsOf(net, n)]);
    expect(g.every((x) => x.length === 1)).toBe(true);
    expect(new Set(g.map((x) => x[0])).size).toBe(3);
  });

  it('split: 駅名の挙げ漏れはエラー', () => {
    expect(() => build({ split: [['新宿', '新宿三丁目']] })).toThrow(/新宿西口/);
  });

  it('該当グループが0件ならエラー', () => {
    expect(() => build({ exclude: [['存在しない駅']] })).toThrow(/0 件/);
  });

  it('該当グループが複数ならエラー', () => {
    // 同名駅が複数グループに跨っていなくても、東京など単独の名前では1件。ここでは分割後の曖昧さを再現できないため新宿を2回 split して検証
    expect(() => build({ split: [SHINJUKU, SHINJUKU] })).toThrow();
  });

  it('merge: 2グループを統合できる', () => {
    const net = build({ merge: [[['東京'], ['上野']]] });
    expect(new Set(net.stations.map((s) => s.group)).size).toBe(baseGroupCount - 1);
    expect([...groupsOf(net, '東京')][0]).toBe([...groupsOf(net, '上野')][0]);
  });

  it('exclude: グループ内の全駅に noQuestion が付き、他は付かない', () => {
    const net = build({ exclude: [['新宿三丁目']] });
    for (const s of net.stations) {
      expect(s.noQuestion === true).toBe(SHINJUKU.includes(s.name));
    }
    expect(base.stations.some((s) => s.noQuestion)).toBe(false);
  });

  it('generateQuestion は noQuestion の駅を出発・到着にしない', () => {
    const net = build({ exclude: [['新宿三丁目']] });
    const all = net.stations.map((_, i) => i);
    let produced = 0;
    for (let i = 0; i < 100; i++) {
      const q = generateQuestion(net, all, { minTransfers: 0, rng: Math.random });
      if (!q) continue;
      produced++;
      expect(net.stations[q.origin].noQuestion).toBeUndefined();
      expect(net.stations[q.destination].noQuestion).toBeUndefined();
    }
    expect(produced).toBeGreaterThan(0);
  });

  it('候補が noQuestion だけなら null', () => {
    const net = build({ exclude: [['新宿三丁目']] });
    const only = net.stations.flatMap((s, i) => (s.noQuestion ? [i] : []));
    expect(generateQuestion(net, only, { minTransfers: 0 })).toBeNull();
  });
});
