import { describe, expect, it } from 'vitest';
import { miniNetwork } from './fixtures/miniEkidata.ts';
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

  it('名古屋駅は nagoya 内', () => {
    expect(pointInArea(136.882, 35.171, 'nagoya')).toBe(true);
  });

  it('大阪駅は osaka 内', () => {
    expect(pointInArea(135.495, 34.702, 'osaka')).toBe(true);
  });

  it('京都駅は osaka 外', () => {
    expect(pointInArea(135.759, 34.985, 'osaka')).toBe(false);
  });

  it('japan は常に true', () => {
    expect(pointInArea(135.759, 34.985, 'japan')).toBe(true);
    expect(pointInArea(0, 0, 'japan')).toBe(true);
  });

  it('AREA_LABELS が全AreaIdに対して表示名を持つ', () => {
    expect(AREA_LABELS.tokyo23).toBeTruthy();
    expect(AREA_LABELS.tokyo).toBeTruthy();
    expect(AREA_LABELS.nagoya).toBeTruthy();
    expect(AREA_LABELS.osaka).toBeTruthy();
    expect(AREA_LABELS.japan).toBeTruthy();
  });
});

describe('stationsInArea', () => {
  const network = miniNetwork();

  it('ミニネットワークの全駅が tokyo23 内（すべて都心の駅のため）', () => {
    const inArea = stationsInArea(network, 'tokyo23');
    expect(inArea.length).toBe(network.stations.length);
  });

  it('ミニネットワークの全駅が japan 内', () => {
    const inArea = stationsInArea(network, 'japan');
    expect(inArea.length).toBe(network.stations.length);
  });

  it('ミニネットワークの全駅が nagoya 内では0件', () => {
    const inArea = stationsInArea(network, 'nagoya');
    expect(inArea.length).toBe(0);
  });
});
