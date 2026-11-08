import { describe, expect, it } from 'vitest';
import { miniNetwork } from './fixtures/miniMt3d.ts';
import { AREA_LABELS, pointInArea, stationsInArea } from '../src/lib/area.ts';

describe('pointInArea', () => {
  it('東京駅は tokyo23 内', () => {
    expect(pointInArea(139.767, 35.681, 'tokyo23')).toBe(true);
  });

  it('新宿は tokyo23 内', () => {
    expect(pointInArea(139.7, 35.69, 'tokyo23')).toBe(true);
  });

  it('吉祥寺は tokyo23 外かつ tokyo 内', () => {
    expect(pointInArea(139.58, 35.703, 'tokyo23')).toBe(false);
    expect(pointInArea(139.58, 35.703, 'tokyo')).toBe(true);
  });

  it('横浜は tokyo 外', () => {
    expect(pointInArea(139.622, 35.466, 'tokyo')).toBe(false);
  });

  it('mt3d（首都圏）は常に true', () => {
    expect(pointInArea(135.759, 34.985, 'mt3d')).toBe(true);
    expect(pointInArea(0, 0, 'mt3d')).toBe(true);
  });

  it('AREA_LABELS が全AreaIdに対して表示名を持つ', () => {
    expect(AREA_LABELS.tokyo23).toBe('東京23区内');
    expect(AREA_LABELS.tokyo).toBe('東京都内');
    expect(AREA_LABELS.mt3d).toContain('Mini Tokyo 3D');
    expect(Object.keys(AREA_LABELS)).toHaveLength(3);
  });
});

describe('stationsInArea', () => {
  const network = miniNetwork();

  it('mt3d は全駅を返す', () => {
    expect(stationsInArea(network, 'mt3d')).toHaveLength(network.stations.length);
  });

  it('tokyo23 には横浜・小田原方面の駅（東横線の横浜等）は含まれない', () => {
    const inArea = new Set(stationsInArea(network, 'tokyo23'));
    const yokohama = network.stations.findIndex((s) => s.name === '横浜');
    expect(inArea.has(yokohama)).toBe(false);
    const tokyo = network.stations.findIndex((s) => s.name === '東京');
    expect(inArea.has(tokyo)).toBe(true);
  });
});
