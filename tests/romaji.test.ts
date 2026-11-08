import { describe, expect, it } from 'vitest';
import { filterOptions, type AutocompleteOption } from '../src/lib/autocomplete.ts';
import { isRomanizable, kanaToRomaji, normalizeRomaji, romajiKeyOfInput } from '../src/lib/romaji.ts';

describe('kanaToRomaji', () => {
  it('基本のひらがな・カタカナ（ヘボン式）', () => {
    expect(kanaToRomaji('しんじゅく')).toBe('shinjuku');
    expect(kanaToRomaji('シンジュク')).toBe('shinjuku');
    expect(kanaToRomaji('つくば')).toBe('tsukuba');
    expect(kanaToRomaji('ふじさわ')).toBe('fujisawa');
    expect(kanaToRomaji('ちば')).toBe('chiba');
  });

  it('拗音・促音・長音符', () => {
    expect(kanaToRomaji('しゃ')).toBe('sha');
    expect(kanaToRomaji('とうきょう')).toBe('toukyou');
    expect(kanaToRomaji('きっぷ')).toBe('kippu');
    expect(kanaToRomaji('まっちゃ')).toBe('matcha');
    expect(kanaToRomaji('ラーメン')).toBe('raamen');
    expect(kanaToRomaji('おおさき')).toBe('oosaki');
  });

  it('かな以外はそのまま残す', () => {
    expect(kanaToRomaji('shinjuku')).toBe('shinjuku');
    expect(kanaToRomaji('JR')).toBe('JR');
  });
});

describe('normalizeRomaji', () => {
  it('小文字化・非英字除去・長音の揺れ（ou/oo/uu）・m+b/m/p の揃え', () => {
    expect(normalizeRomaji('Shin-Okubo')).toBe('shinokubo');
    expect(normalizeRomaji('Ōsaki')).toBe('osaki');
    expect(normalizeRomaji('Ootemachi')).toBe('otemachi');
    expect(normalizeRomaji('Yūrakuchō')).toBe('yurakucho');
    expect(normalizeRomaji('Shimbashi')).toBe(normalizeRomaji('shinbashi'));
    expect(normalizeRomaji('Tokyo Metro Ginza Line')).toBe('tokyometroginzaline');
  });
});

describe('romajiKeyOfInput / isRomanizable', () => {
  it('かな・ローマ字入力は同じキーになる', () => {
    const key = romajiKeyOfInput('しんじゅく');
    expect(key).toBe('shinjuku');
    expect(romajiKeyOfInput('シンジュク')).toBe(key);
    expect(romajiKeyOfInput('Shinjuku')).toBe(key);
    expect(romajiKeyOfInput('おおさき')).toBe(normalizeRomaji('Osaki'));
    expect(romajiKeyOfInput('しんばし')).toBe(normalizeRomaji('Shimbashi'));
  });

  it('漢字を含む入力はローマ字照合なし（空文字）', () => {
    expect(isRomanizable('新宿')).toBe(false);
    expect(romajiKeyOfInput('新宿')).toBe('');
    expect(isRomanizable('しんじゅく')).toBe(true);
  });
});

describe('filterOptions のローマ字照合', () => {
  const options: AutocompleteOption[] = [
    { id: 1, label: '新宿', searchText: '新宿', romaji: normalizeRomaji('Shinjuku') },
    { id: 2, label: '大崎', searchText: '大崎', romaji: normalizeRomaji('Osaki') },
    { id: 3, label: '大手町', searchText: '大手町', romaji: normalizeRomaji('Otemachi') },
    { id: 4, label: '新橋', searchText: '新橋', romaji: normalizeRomaji('Shimbashi') },
    { id: 5, label: '渋谷', searchText: '渋谷', romaji: normalizeRomaji('Shibuya') },
  ];
  const ids = (q: string) => filterOptions(options, q).map((o) => o.id);

  it('しんじゅく / シンジュク / shinjuku / SHINJUKU が 新宿 にヒットする', () => {
    for (const q of ['しんじゅく', 'シンジュク', 'shinjuku', 'SHINJUKU', 'Shin juku']) {
      expect(ids(q)).toEqual([1]);
    }
  });

  it('おおさき は Osaki（大崎）にヒット（長音の揺れ）', () => {
    expect(ids('おおさき')).toEqual([2]);
    expect(ids('おおてまち')).toEqual([3]);
  });

  it('しんばし は Shimbashi にヒット（m/n の揺れ）', () => {
    expect(ids('しんばし')).toEqual([4]);
  });

  it('部分一致: shi は 新宿・新橋・渋谷 の3件、前方一致順', () => {
    expect(ids('shi').sort()).toEqual([1, 4, 5]);
  });

  it('日本語クエリは従来どおり日本語名で照合する', () => {
    expect(ids('新')).toEqual([1, 4]);
    expect(ids('渋')).toEqual([5]);
  });
});
