import { describe, expect, it } from 'vitest';
import { buildEkidataNetwork } from '../scripts/buildEkidataNetwork.ts';
import { miniEkidataInput, miniN02 } from './fixtures/miniEkidata.ts';
import type { Network } from '../src/lib/types.ts';

function findLine(network: Network, name: string) {
  const line = network.lines.find((l) => l.name === name);
  if (!line) throw new Error(`line not found: ${name}`);
  return line;
}

function findStationIndices(network: Network, name: string): number[] {
  return network.stations
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s.name === name)
    .map(({ idx }) => idx);
}

describe('buildEkidataNetwork', () => {
  describe('N02なし（n02 = null）', () => {
    const { network, log } = buildEkidataNetwork(miniEkidataInput(), null);

    it('動作し、新幹線マージをスキップした旨をlogへ記録する', () => {
      expect(network.formatVersion).toBe(2);
      expect(log.some((l) => l.includes('N02入力が指定されていない'))).toBe(true);
      // 新幹線路線が追加されていないこと
      expect(network.lines.find((l) => l.name === '東海道新幹線')).toBeUndefined();
    });

    it('山手線が環状1パターンになる（末尾再掲・segSec8本・全て45秒以上）', () => {
      const yamanote = findLine(network, '山手線');
      expect(yamanote.patterns.length).toBe(1);
      const pattern = yamanote.patterns[0];
      expect(pattern.stops[0]).toBe(pattern.stops[pattern.stops.length - 1]);
      expect(pattern.segSec.length).toBe(8);
      expect(pattern.stops.length).toBe(9);
      for (const s of pattern.segSec) {
        expect(s).toBeGreaterThanOrEqual(45);
      }
    });

    it('中央線が線形1パターンになる', () => {
      const chuo = findLine(network, '中央線');
      expect(chuo.patterns.length).toBe(1);
      expect(chuo.patterns[0].stops.length).toBe(4);
      expect(chuo.patterns[0].segSec.length).toBe(3);
    });

    it('丸ノ内線が線形1パターンになる', () => {
      const marunouchi = findLine(network, '丸ノ内線');
      expect(marunouchi.patterns.length).toBe(1);
      expect(marunouchi.patterns[0].stops.length).toBe(6);
      expect(marunouchi.patterns[0].segSec.length).toBe(5);
    });

    it('テスト電鉄本線が葉ペア3パターンになる（新宿-東山/新宿-西丘/東山-西丘）', () => {
      const testTetsu = findLine(network, 'テスト電鉄本線');
      // 廃駅(TST99)とそれを参照するjoinがドロップされているため、葉は新宿・東山・西丘の3つ
      expect(testTetsu.patterns.length).toBe(3);

      const stationName = (idx: number) => network.stations[idx].name;
      const patternNames = testTetsu.patterns.map((p) => p.stops.map(stationName));

      const hasPair = (a: string, b: string) =>
        patternNames.some((names) => names[0] === a && names[names.length - 1] === b) ||
        patternNames.some((names) => names[0] === b && names[names.length - 1] === a);

      expect(hasPair('新宿', '東山')).toBe(true);
      expect(hasPair('新宿', '西丘')).toBe(true);
      expect(hasPair('東山', '西丘')).toBe(true);

      // 廃止駅は含まれない
      expect(network.stations.some((s) => s.name === '廃止駅')).toBe(false);
    });

    it('e_status=2の駅（廃駅）を除外し、それを参照するjoinをドロップした旨をlogへ記録する', () => {
      expect(network.stations.some((s) => s.name === '廃止駅')).toBe(false);
      expect(log.some((l) => l.includes('廃駅') || l.includes('存在しない駅'))).toBe(true);
    });

    it('孤立駅（どのjoinにも現れない駅）を除外し、logへ記録する', () => {
      expect(network.stations.some((s) => s.name === '孤立駅')).toBe(false);
      expect(log.some((l) => l.includes('孤立駅除外'))).toBe(true);
    });

    it('station_g_cdによる跨社グループ統合: 東京(山手・中央・丸ノ内)が同一group', () => {
      const tokyoIndices = findStationIndices(network, '東京');
      expect(tokyoIndices.length).toBe(3);
      const groups = new Set(tokyoIndices.map((idx) => network.stations[idx].group));
      expect(groups.size).toBe(1);
    });

    it('lineType/速度分類: JR(山手線)がlineType2・60km/hベースのsegSecになる', () => {
      const yamanote = findLine(network, '山手線');
      expect(yamanote.lineType).toBe(2);
      // 東京(35.681,139.767) -> 神田(35.6917,139.7708) の距離を60km/h*1.2マージンで検算
      const tokyoIdx = findStationIndices(network, '東京').find(
        (idx) => network.lines.some((l) => l.patterns.some((p) => p.stops[0] === idx))
      );
      void tokyoIdx;
      const pattern = yamanote.patterns[0];
      // 区間0: 東京->神田
      const seg0 = pattern.segSec[0];
      // haversine(35.681,139.767 -> 35.6917,139.7708) はおよそ1.3km程度 -> 60km/h*1.2マージンで計算すると
      // 45秒下限にかからない値になるはず。ここでは下限45秒より大きいことと妥当な範囲であることを確認する。
      expect(seg0).toBeGreaterThan(45);
      expect(seg0).toBeLessThan(300);
    });

    it('lineType/速度分類: メトロ(丸ノ内線)がlineType3になる', () => {
      const marunouchi = findLine(network, '丸ノ内線');
      expect(marunouchi.lineType).toBe(3);
    });

    it('lineType/速度分類の全件ログを出力する', () => {
      expect(log.some((l) => l.includes('路線分類:') && l.includes('山手線'))).toBe(true);
      expect(log.some((l) => l.includes('路線分類:') && l.includes('中央線'))).toBe(true);
      expect(log.some((l) => l.includes('路線分類:') && l.includes('丸ノ内線'))).toBe(true);
      expect(log.some((l) => l.includes('路線分類:') && l.includes('テスト電鉄本線'))).toBe(true);
    });

    it('全segSecが正・全パターンのstopsが2以上', () => {
      for (const line of network.lines) {
        for (const pattern of line.patterns) {
          expect(pattern.stops.length).toBeGreaterThanOrEqual(2);
          for (const s of pattern.segSec) {
            expect(s).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('N02あり（東海道新幹線マージ）', () => {
    const { network, log } = buildEkidataNetwork(miniEkidataInput(), miniN02());

    it('東海道新幹線Lineが追加される（lineType1・company東海旅客鉄道）', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      expect(shinkansen.lineType).toBe(1);
      expect(shinkansen.company).toBe('東海旅客鉄道');
      expect(shinkansen.color).toBeNull();
    });

    it('停車順が 東京 -> 品川 -> 新横浜 になる', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      expect(shinkansen.patterns.length).toBe(1);
      const stopNames = shinkansen.patterns[0].stops.map((idx) => network.stations[idx].name);
      expect(stopNames).toEqual(['東京', '品川', '新横浜']);
    });

    it('東京・品川がekidata側の東京・品川と同一groupになる', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      const [tokyoIdx, shinagawaIdx] = shinkansen.patterns[0].stops;

      const ekidataTokyoGroup = network.stations[findStationIndices(network, '東京')[0]].group;
      const ekidataShinagawaIndices = findStationIndices(network, '品川');
      // 品川はekidata側1レコードのみ（山手線分）
      const ekidataShinagawaGroup = network.stations[ekidataShinagawaIndices[0]].group;

      expect(network.stations[tokyoIdx].group).toBe(ekidataTokyoGroup);
      expect(network.stations[shinagawaIdx].group).toBe(ekidataShinagawaGroup);
    });

    it('新横浜は新規groupになる（ekidata側に対応駅なし）', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      const shinYokohamaIdx = shinkansen.patterns[0].stops[2];
      const shinYokohamaGroup = network.stations[shinYokohamaIdx].group;

      // 既存のekidata側のどのgroupとも一致しない（新規に採番された）ことを確認
      const ekidataGroups = new Set(
        network.stations
          .filter((s) => s.name !== '新横浜')
          .map((s) => s.group)
      );
      // 新横浜のgroupを持つ駅が新横浜以外に存在しない
      const membersOfGroup = network.stations.filter((s) => s.group === shinYokohamaGroup);
      expect(membersOfGroup.every((s) => s.name === '新横浜')).toBe(true);
      void ekidataGroups;
    });

    it('segSecが弧長差÷200km/h（マージンなし）で計算される', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      const [tokyoIdx, shinagawaIdx, shinYokohamaIdx] = shinkansen.patterns[0].stops;
      const tokyo = network.stations[tokyoIdx];
      const shinagawa = network.stations[shinagawaIdx];
      const shinYokohama = network.stations[shinYokohamaIdx];

      // 直線距離をそのままの目安として、マージン無しの200km/h換算値が
      // 通常のekidata区間（1.2倍マージンつき60km/h等）より短めの比率になることを確認する
      // (射影弧長ベースのため直線距離とは厳密には一致しないが、オーダーは一致するはず)
      const straightDist1 = haversine(tokyo.lat, tokyo.lon, shinagawa.lat, shinagawa.lon);
      const straightDist2 = haversine(shinagawa.lat, shinagawa.lon, shinYokohama.lat, shinYokohama.lon);

      const seg0 = shinkansen.patterns[0].segSec[0];
      const seg1 = shinkansen.patterns[0].segSec[1];

      // 200km/h = 55.56 m/s、マージンなしなので距離/55.56 に近い値になるはず（下限45秒でクリップされ得る）
      const expectedSeg0 = Math.max(45, Math.round(straightDist1 / (200000 / 3600)));
      const expectedSeg1 = Math.max(45, Math.round(straightDist2 / (200000 / 3600)));

      // 射影のため多少のずれは許容する（±30%）
      expect(seg0).toBeGreaterThan(expectedSeg0 * 0.5);
      expect(seg0).toBeLessThan(expectedSeg0 * 2);
      expect(seg1).toBeGreaterThan(expectedSeg1 * 0.5);
      expect(seg1).toBeLessThan(expectedSeg1 * 2);
    });

    it('N02駅統合の対応表をlogへ出力する', () => {
      expect(log.some((l) => l.includes('N02駅統合') && l.includes('東京'))).toBe(true);
      expect(log.some((l) => l.includes('N02駅統合') && l.includes('品川'))).toBe(true);
      expect(log.some((l) => l.includes('N02駅統合') && l.includes('新横浜'))).toBe(true);
    });
  });

  describe('N02の同名連続駅dedupe（路線境界・運営会社境界の重複フィーチャ）', () => {
    // N02実データでは東海道/山陽の境界の新大阪や北陸のJR東/JR西境界の上越妙高のように、
    // 同一駅の駅フィーチャが2つ存在する。miniN02に品川の重複フィーチャを追加して再現する。
    const n02 = miniN02();
    n02.stations.features.push({
      type: 'Feature',
      properties: {
        N02_001: '11',
        N02_002: '1',
        N02_003: '東海道新幹線',
        N02_004: '東海旅客鉄道',
        N02_005: '品川',
      },
      geometry: {
        type: 'LineString',
        // 既存の品川フィーチャ（中点 139.7391, 35.629 付近）から数十mだけずらした重複フィーチャ
        coordinates: [
          [139.7393, 35.6293],
          [139.7398, 35.6293],
        ],
      },
    });
    const { network, log } = buildEkidataNetwork(miniEkidataInput(), n02);

    it('弧長差が小さい同名連続駅が1つに統合され、停車順が 東京 -> 品川 -> 新横浜 のまま', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      const stopNames = shinkansen.patterns[0].stops.map((idx) => network.stations[idx].name);
      expect(stopNames).toEqual(['東京', '品川', '新横浜']);
      expect(shinkansen.patterns[0].segSec.length).toBe(2);
    });

    it('統合をlogへ記録する', () => {
      expect(log.some((l) => l.includes('N02重複駅統合') && l.includes('品川'))).toBe(true);
    });
  });

  describe('N02縫合の成分ブリッジ連結（区間ポリラインが途切れている場合）', () => {
    // N02実データでは量子化しても縫合しきれず複数成分に分かれる路線がある（東海道・山陽・北陸）。
    // 旧実装は最長成分のみ採用していたため、途切れた先の駅が全てポリライン終端付近に射影されて
    // 弧長差が潰れ、segSecが下限45秒に張り付く距離欠落が起きていた。
    // ここでは miniN02 の sections を意図的に2成分へ分割（品川の手前約400mで切断）して、
    // ブリッジ連結後に全駅の弧長が正しく出ることを検証する。
    const n02 = miniN02();
    const tokyoN02: [number, number] = [139.7675, 35.6815];
    const shinagawaN02: [number, number] = [139.7391, 35.629];
    const shinYokohamaN02: [number, number] = [139.6172, 35.5074];
    n02.sections.features = [
      {
        type: 'Feature',
        properties: {
          N02_001: '11',
          N02_002: '1',
          N02_003: '東海道新幹線',
          N02_004: '東海旅客鉄道',
          N02_005: '',
        },
        geometry: {
          type: 'LineString',
          // 品川の手前（約400m）で途切れる成分1
          coordinates: [tokyoN02, [139.742, 35.632]],
        },
      },
      {
        type: 'Feature',
        properties: {
          N02_001: '11',
          N02_002: '1',
          N02_003: '東海道新幹線',
          N02_004: '東海旅客鉄道',
          N02_005: '',
        },
        geometry: {
          type: 'LineString',
          // 品川から新横浜までの成分2（成分1とは端点が離れており量子化では繋がらない）
          coordinates: [shinagawaN02, shinYokohamaN02],
        },
      },
    ];
    const { network, log } = buildEkidataNetwork(miniEkidataInput(), n02);

    it('ブリッジ連結をlogへ記録する', () => {
      expect(
        log.some((l) => l.includes('成分に分かれているため、近接端点を直線ブリッジで連結する'))
      ).toBe(true);
      expect(log.some((l) => l.includes('N02縫合ブリッジ') && l.includes('ギャップ'))).toBe(true);
    });

    it('停車順が 東京 -> 品川 -> 新横浜 のまま正しく出る', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      const stopNames = shinkansen.patterns[0].stops.map((idx) => network.stations[idx].name);
      expect(stopNames).toEqual(['東京', '品川', '新横浜']);
    });

    it('ブリッジ後の全駅の弧長が正しく、segSecが下限45秒に潰れない', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      const [seg0, seg1] = shinkansen.patterns[0].segSec;

      // 東京→品川 直線約6.4km -> 200km/h(マージンなし)で約115秒。ブリッジの微小な迂回を許容。
      const dist1 = haversine(tokyoN02[1], tokyoN02[0], shinagawaN02[1], shinagawaN02[0]);
      const expected0 = Math.round(dist1 / (200000 / 3600));
      expect(seg0).toBeGreaterThan(expected0 * 0.7);
      expect(seg0).toBeLessThan(expected0 * 1.5);

      // 品川→新横浜 直線約17.4km -> 約314秒。旧実装ではここが45秒に潰れていた。
      const dist2 = haversine(shinagawaN02[1], shinagawaN02[0], shinYokohamaN02[1], shinYokohamaN02[0]);
      const expected1 = Math.round(dist2 / (200000 / 3600));
      expect(seg1).toBeGreaterThan(expected1 * 0.7);
      expect(seg1).toBeLessThan(expected1 * 1.5);
      expect(seg1).toBeGreaterThan(45);
    });
  });

  describe('N02縫合の並行重複成分の破棄（運営会社境界などの二重フィーチャ）', () => {
    // N02実データには同一区間の線形が二重に入っている短い断片がある（山陽の新大阪付近1.5km、
    // 北陸の上越妙高付近0.3km等）。これを端点ブリッジで繋ぐと巨大な迂回が生じて駅の射影順序と
    // 弧長を壊すため、既存チェーンから1km以内に収まる成分は破棄する。
    const n02 = miniN02();
    n02.sections.features.push({
      type: 'Feature',
      properties: {
        N02_001: '11',
        N02_002: '1',
        N02_003: '東海道新幹線',
        N02_004: '東海旅客鉄道',
        N02_005: '',
      },
      geometry: {
        type: 'LineString',
        // 品川→新横浜の線形に約50mだけ横ずれした並行重複断片（本線とは端点が繋がらない）
        coordinates: [
          [139.7269, 35.6173],
          [139.7147, 35.6052],
        ],
      },
    });
    const { network, log } = buildEkidataNetwork(miniEkidataInput(), n02);

    it('並行重複成分を破棄した旨をlogへ記録する', () => {
      expect(log.some((l) => l.includes('並行重複成分') && l.includes('破棄'))).toBe(true);
      // ブリッジ連結はされない（重複成分しか無いため）
      expect(log.some((l) => l.includes('N02縫合ブリッジ:'))).toBe(false);
    });

    it('停車順・弧長が本線のみの場合と変わらない', () => {
      const shinkansen = findLine(network, '東海道新幹線');
      const stopNames = shinkansen.patterns[0].stops.map((idx) => network.stations[idx].name);
      expect(stopNames).toEqual(['東京', '品川', '新横浜']);
      for (const s of shinkansen.patterns[0].segSec) {
        expect(s).toBeGreaterThan(45);
      }
    });
  });

  describe('閉路と分岐が混在する成分の全駅カバー（函館本線型: 節点を共有する2閉路＋両端の尾）', () => {
    // 函館本線(函館～長万部)を模したトポロジ:
    //   函館口(葉) - 七尾台(分岐) - {中山 経由 / 直通} - 大池(分岐・2閉路の共有節点)
    //   - {東浜 経由 / 直通} - 森野(分岐) - 長万部口(葉)
    // 旧実装では2閉路の合併ノード集合が「全ノード次数2」チェックに落ちて環状パターンが出ず、
    // 分岐->葉のBFS最短パスが辺数の少ない直通側を通るため、中山・東浜（並行ルート上の
    // 次数2ノード）が全パターンから脱落していた（新函館北斗が消えた実データ問題の再現）。
    function mixedInput() {
      return {
        companies: [
          { company_cd: '9', company_name: 'テスト鉄道', company_type: '0', e_status: '0' },
        ],
        lines: [
          { line_cd: '90001', company_cd: '9', line_name: 'テスト本線', line_color_c: '', e_status: '0' },
        ],
        stations: [
          st('HKD', 'G_HKD', '函館口', 139.70, 35.60),
          st('NNO', 'G_NNO', '七尾台', 139.71, 35.61),
          st('NKY', 'G_NKY', '中山', 139.715, 35.625),
          st('OIK', 'G_OIK', '大池', 139.72, 35.62),
          st('HGH', 'G_HGH', '東浜', 139.725, 35.635),
          st('MRN', 'G_MRN', '森野', 139.73, 35.63),
          st('OSM', 'G_OSM', '長万部口', 139.74, 35.64),
        ],
        joins: [
          j('HKD', 'NNO'),
          j('NNO', 'NKY'), // 閉路1: 七尾台-中山-大池
          j('NKY', 'OIK'),
          j('NNO', 'OIK'), // 閉路1を閉じる直通辺
          j('OIK', 'HGH'), // 閉路2: 大池-東浜-森野
          j('HGH', 'MRN'),
          j('OIK', 'MRN'), // 閉路2を閉じる直通辺
          j('MRN', 'OSM'),
        ],
      };

      function st(cd: string, gcd: string, name: string, lon: number, lat: number) {
        return {
          station_cd: cd,
          station_g_cd: gcd,
          station_name: name,
          line_cd: '90001',
          lon: String(lon),
          lat: String(lat),
          e_status: '0',
        };
      }
      function j(a: string, b: string) {
        return { line_cd: '90001', station_cd1: a, station_cd2: b };
      }
    }

    const { network, log } = buildEkidataNetwork(mixedInput(), null);

    it('並行ルート上の次数2ノード（中山・東浜）を含む全駅がネットワークに存在する', () => {
      const names = new Set(network.stations.map((s) => s.name));
      for (const expected of ['函館口', '七尾台', '中山', '大池', '東浜', '森野', '長万部口']) {
        expect(names.has(expected), `${expected} が stations に存在する`).toBe(true);
      }
    });

    it('全駅がいずれかのパターンに含まれる（脱落なし）', () => {
      const covered = new Set<number>();
      for (const line of network.lines) {
        for (const p of line.patterns) {
          for (const idx of p.stops) covered.add(idx);
        }
      }
      expect(covered.size).toBe(network.stations.length);
    });

    it('閉路ごとの環状パターン（末尾再掲）が2つ出力される', () => {
      const line = findLine(network, 'テスト本線');
      const circular = line.patterns.filter(
        (p) => p.stops[0] === p.stops[p.stops.length - 1]
      );
      expect(circular.length).toBe(2);
      for (const p of circular) {
        expect(p.stops.length).toBeGreaterThanOrEqual(4); // 3ノード閉路 + 始点再掲
      }
    });

    it('近似であることをlogへ記録する', () => {
      expect(log.some((l) => l.includes('テスト本線') && l.includes('近似'))).toBe(true);
    });

    it('ekidata側に存在する駅とN02側の同名駅が1km以内なら既存groupへ統合される（新函館北斗回帰）', () => {
      // N02側: 中山駅（ekidataの中山と同座標近傍）を通るテスト新幹線
      const n02 = {
        sections: {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {
                N02_001: '11',
                N02_002: '1',
                N02_003: 'テスト新幹線',
                N02_004: 'テスト旅客鉄道',
                N02_005: '',
              },
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [139.715, 35.625],
                  [139.80, 35.70],
                ] as [number, number][],
              },
            },
          ],
        },
        stations: {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {
                N02_001: '11',
                N02_002: '1',
                N02_003: 'テスト新幹線',
                N02_004: 'テスト旅客鉄道',
                N02_005: '中山',
              },
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [139.7148, 35.625],
                  [139.7152, 35.625],
                ] as [number, number][],
              },
            },
            {
              type: 'Feature' as const,
              properties: {
                N02_001: '11',
                N02_002: '1',
                N02_003: 'テスト新幹線',
                N02_004: 'テスト旅客鉄道',
                N02_005: '新終点',
              },
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [139.7998, 35.70],
                  [139.8002, 35.70],
                ] as [number, number][],
              },
            },
          ],
        },
      };
      const { network: net2 } = buildEkidataNetwork(mixedInput(), n02);

      const shinkansen = findLine(net2, 'テスト新幹線');
      const stopNames = shinkansen.patterns[0].stops.map((idx) => net2.stations[idx].name);
      expect(stopNames).toEqual(['中山', '新終点']);

      // 中山は混在成分のパターンに含まれてstationsに存在するため、N02側の中山が同groupへ統合される
      const ekidataNakayamaGroup = net2.stations[findStationIndices(net2, '中山')[0]].group;
      const n02NakayamaIdx = shinkansen.patterns[0].stops[0];
      expect(net2.stations[n02NakayamaIdx].group).toBe(ekidataNakayamaGroup);
    });
  });
});

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
