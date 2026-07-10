import { describe, expect, it } from 'vitest';
import {
  filterOptions,
  normalizeQuery,
  type AutocompleteOption,
} from '../src/lib/autocomplete.ts';

function opt(id: number, label: string, searchText = label): AutocompleteOption {
  return { id, label, searchText };
}

describe('normalizeQuery', () => {
  it('NFKC正規化する（全角英数 -> 半角）', () => {
    expect(normalizeQuery('ＡＢＣ１２３')).toBe('abc123');
  });

  it('半角カナをNFKCで全角カナに正規化する', () => {
    // NFKC: 半角カナ(ｷﾞﾝｻﾞ) -> 全角カナ(ギンザ)
    expect(normalizeQuery('ｷﾞﾝｻﾞ')).toBe(normalizeQuery('ギンザ'));
  });

  it('全角・半角の空白を除去する', () => {
    expect(normalizeQuery('東京 メトロ　銀座線')).toBe('東京メトロ銀座線');
  });

  it('大文字を小文字化する', () => {
    expect(normalizeQuery('JR East')).toBe('jreast');
  });

  it('空文字はそのまま空文字になる', () => {
    expect(normalizeQuery('')).toBe('');
  });
});

describe('filterOptions', () => {
  const options: AutocompleteOption[] = [
    opt(1, '銀座線（東京メトロ）'),
    opt(2, '東京メトロ丸ノ内線（東京メトロ）'),
    opt(3, '山手線（JR東日本）'),
    opt(4, '中央線（JR東日本）'),
    opt(5, '東京駅'),
  ];

  it('部分一致でフィルタする', () => {
    const result = filterOptions(options, '東京メトロ');
    // id=2「東京メトロ丸ノ内線（東京メトロ）」は前方一致、id=1「銀座線（東京メトロ）」は部分一致
    expect(result.map((o) => o.id)).toEqual([2, 1]);
  });

  it('前方一致を部分一致より優先する（元の出現順は維持）', () => {
    // '銀座線' が前方一致で id=1、'新橋発銀座線経由' 的な部分一致は含む文字列でのみ一致するケースを検証
    const mixed: AutocompleteOption[] = [
      opt(10, '都営浅草線経由銀座'), // 部分一致（先頭ではない）
      opt(11, '銀座線（東京メトロ）'), // 前方一致
      opt(12, '銀座'), // 前方一致
    ];
    const result = filterOptions(mixed, '銀座');
    // 前方一致グループ（id 11, 12: 元の順序維持）が先、部分一致グループ（id 10）が後
    expect(result.map((o) => o.id)).toEqual([11, 12, 10]);
  });

  it('前方一致グループ内・部分一致グループ内それぞれで元の配列順を維持する（安定ソート）', () => {
    const list: AutocompleteOption[] = [
      opt(1, 'あいう'),
      opt(2, 'あいえ'),
      opt(3, 'かあいう'), // 部分一致のみ
      opt(4, 'あいお'),
      opt(5, 'さかあいう'), // 部分一致のみ
    ];
    const result = filterOptions(list, 'あい');
    expect(result.map((o) => o.id)).toEqual([1, 2, 4, 3, 5]);
  });

  it('queryが空文字なら options 先頭から maxResults 件をそのまま返す', () => {
    const result = filterOptions(options, '', 3);
    expect(result.map((o) => o.id)).toEqual([1, 2, 3]);
  });

  it('queryが空文字かつ options が maxResults 未満ならすべて返す', () => {
    const result = filterOptions(options, '');
    expect(result.length).toBe(options.length);
  });

  it('全角・半角の表記ゆれを吸収して一致する（NFKC正規化）', () => {
    const list: AutocompleteOption[] = [opt(1, 'ｷﾞﾝｻﾞ線（東京メトロ）')];
    const result = filterOptions(list, 'ギンザ');
    expect(result.map((o) => o.id)).toEqual([1]);
  });

  it('空白を含むクエリでも空白を除去して一致する', () => {
    const list: AutocompleteOption[] = [opt(1, '東京メトロ銀座線')];
    const result = filterOptions(list, '東京 メトロ');
    expect(result.map((o) => o.id)).toEqual([1]);
  });

  it('大文字小文字を区別しない', () => {
    const list: AutocompleteOption[] = [opt(1, 'JR East Line')];
    expect(filterOptions(list, 'jr east').map((o) => o.id)).toEqual([1]);
  });

  it('一致するものがなければ空配列を返す', () => {
    expect(filterOptions(options, '存在しない文字列')).toEqual([]);
  });

  it('maxResults の上限を超えない', () => {
    const many: AutocompleteOption[] = Array.from({ length: 100 }, (_, i) => opt(i, `駅${i}`));
    const result = filterOptions(many, '駅');
    expect(result.length).toBe(50); // デフォルト
  });

  it('maxResults を明示的に指定できる', () => {
    const many: AutocompleteOption[] = Array.from({ length: 20 }, (_, i) => opt(i, `駅${i}`));
    const result = filterOptions(many, '駅', 5);
    expect(result.length).toBe(5);
    expect(result.map((o) => o.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it('デフォルトの maxResults は50件', () => {
    const many: AutocompleteOption[] = Array.from({ length: 60 }, (_, i) => opt(i, `駅${i}`));
    expect(filterOptions(many, '駅').length).toBe(50);
  });

  describe('note フィールド（同名別駅の区別用）', () => {
    const withNotes: AutocompleteOption[] = [
      { id: 1, label: '京橋', searchText: '京橋', note: '大阪環状線（JR西日本）ほか' },
      { id: 2, label: '京橋', searchText: '京橋', note: '銀座線（東京メトロ）ほか' },
      { id: 3, label: '新橋', searchText: '新橋', note: '山手線（JR東日本）ほか' },
    ];

    it('note は filterOptions の結果にそのまま保持される', () => {
      const result = filterOptions(withNotes, '京橋');
      expect(result.map((o) => o.id)).toEqual([1, 2]);
      expect(result[0].note).toBe('大阪環状線（JR西日本）ほか');
      expect(result[1].note).toBe('銀座線（東京メトロ）ほか');
    });

    it('note はマッチ対象に含めない（noteの文字列で検索してもヒットしない）', () => {
      // '大阪環状線' は id=1 の note にのみ含まれ、searchText には含まれない
      expect(filterOptions(withNotes, '大阪環状線')).toEqual([]);
      // '山手線' も同様に note のみ
      expect(filterOptions(withNotes, '山手線')).toEqual([]);
    });

    it('note が無い候補も混在できる', () => {
      const mixed: AutocompleteOption[] = [opt(1, '東京'), ...withNotes];
      const result = filterOptions(mixed, '東京');
      expect(result.map((o) => o.id)).toEqual([1]);
      expect(result[0].note).toBeUndefined();
    });
  });
});
