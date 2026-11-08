/**
 * かな -> ヘボン式ローマ字変換と、ローマ字検索用の正規化。
 * Mini Tokyo 3D にはふりがながないため、駅名・路線名の英語表記（title.en）と
 * ユーザーのかな入力・ローマ字入力を同じ正規化キーに落として照合するために使う。
 */

const BASE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
};

/** 拗音・外来音の2文字結合（先頭の文字 + 小書き文字）。 */
const COMBO: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je',
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  いぇ: 'ye', くぁ: 'kwa', つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
};

/** カタカナをひらがなにする（長音符・中黒などはそのまま）。 */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** 文字列がひらがな・カタカナ・長音符・ローマ字・数字・空白・記号のみ（漢字等を含まない）か。 */
export function isRomanizable(s: string): boolean {
  return /^[\sぁ-ゖァ-ヺーｰa-zA-Zａ-ｚＡ-Ｚ0-9０-９'’\-・.]*$/.test(s);
}

/**
 * ひらがな・カタカナ混じりの文字列をヘボン式ローマ字に変換する。かな以外の文字はそのまま残す。
 * 促音（っ）は次の子音を重ね、長音符（ー）は直前の母音を重ねる。
 */
export function kanaToRomaji(input: string): string {
  const s = toHiragana(input.normalize('NFKC'));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === 'っ') {
      // 次のかなのローマ字の先頭子音を重ねる
      const next = s[i + 1];
      const pair = next !== undefined ? s.slice(i + 1, i + 3) : '';
      const roman = COMBO[pair] ?? (next !== undefined ? BASE[next] : undefined);
      if (roman && /^[a-z]/.test(roman) && !/^[aiueon]/.test(roman)) {
        out += roman[0] === 'c' && roman[1] === 'h' ? 't' : roman[0];
      }
      continue;
    }
    if (ch === 'ー' || ch === 'ｰ') {
      const m = /[aiueo]$/.exec(out);
      if (m) out += m[0];
      continue;
    }
    const pair = s.slice(i, i + 2);
    if (COMBO[pair] !== undefined) {
      out += COMBO[pair];
      i++;
      continue;
    }
    out += BASE[ch] ?? ch;
  }
  return out;
}

/**
 * ローマ字検索用の正規化キー。
 * 小文字化・ダイアクリティカルマーク除去・英小文字以外の除去を行い、
 * 長音の揺れ（ou/oo/uu -> o/o/u）と「m + b/m/p」（Shimbashi -> Shinbashi）を揃える。
 * 英語表記側とユーザー入力側の両方に同じ関数を適用して比較する。
 */
export function normalizeRomaji(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/m(?=[bmp])/g, 'n')
    .replace(/ou|oo/g, 'o')
    .replace(/uu/g, 'u');
}

/** ユーザー入力（かな・ローマ字）の検索キー。漢字などを含む場合は空文字（ローマ字照合なし）。 */
export function romajiKeyOfInput(query: string): string {
  if (!isRomanizable(query)) return '';
  return normalizeRomaji(kanaToRomaji(query));
}
