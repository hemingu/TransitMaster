/**
 * 事業者名の読み仮名テーブル（路線オートコンプリートで事業者名検索を可能にする）。
 * network.json の lines[].company に現れる全事業者を網羅する。
 * - kana: かな読み（ひらがな。カタカナ・ローマ字入力は romaji 経由で照合される）
 * - latin: 英字の通称（JR, TX など。かなに直せないもの）
 * - kanji: 漢字などの略称（小田急 など。searchText にそのまま足す）
 */
import { kanaToRomaji, normalizeRomaji } from './romaji.ts';

export interface CompanyReading {
  kana: string[];
  latin?: string[];
  kanji?: string[];
}

export const COMPANY_READINGS: Record<string, CompanyReading> = {
  'JR東日本': {
    kana: ['じぇいあーる', 'じぇいあーるひがしにほん', 'ひがしにほん', 'じぇいあーるひがし'],
    latin: ['JR', 'JR East', 'JR東日本'],
    kanji: ['JR', 'JR東', '東日本'],
  },
  'JR東海': {
    kana: ['じぇいあーる', 'じぇいあーるとうかい', 'とうかい'],
    latin: ['JR', 'JR Central', 'JR Tokai'],
    kanji: ['JR', '東海'],
  },
  '東京臨海高速鉄道': {
    kana: ['とうきょうりんかいこうそくてつどう', 'りんかい', 'りんかいせん'],
    latin: ['Rinkai'],
    kanji: ['りんかい線', '臨海'],
  },
  '東京メトロ': {
    kana: ['とうきょうめとろ', 'めとろ', 'ちかてつ'],
    latin: ['Tokyo Metro', 'Metro'],
    kanji: ['メトロ', '東京地下鉄'],
  },
  '都営地下鉄': {
    kana: ['とえいちかてつ', 'とえい', 'とうきょうとえい', 'ちかてつ'],
    latin: ['Toei'],
    kanji: ['都営', '東京都交通局'],
  },
  '横浜市営地下鉄': {
    kana: ['よこはましえいちかてつ', 'よこはましえい', 'しえいちかてつ', 'ちかてつ'],
    latin: ['Yokohama Municipal Subway'],
    kanji: ['横浜市営', '市営地下鉄', '横浜市交通局'],
  },
  '京王電鉄': {
    kana: ['けいおうでんてつ', 'けいおう'],
    latin: ['Keio'],
    kanji: ['京王'],
  },
  '京急電鉄': {
    kana: ['けいきゅうでんてつ', 'けいきゅう'],
    latin: ['Keikyu'],
    kanji: ['京急', '京浜急行'],
  },
  '京成電鉄': {
    kana: ['けいせいでんてつ', 'けいせい'],
    latin: ['Keisei'],
    kanji: ['京成'],
  },
  '北総鉄道': {
    kana: ['ほくそうてつどう', 'ほくそう'],
    latin: ['Hokuso'],
    kanji: ['北総'],
  },
  '芝山鉄道': {
    kana: ['しばやまてつどう', 'しばやま'],
    latin: ['Shibayama'],
    kanji: ['芝山'],
  },
  '東武鉄道': {
    kana: ['とうぶてつどう', 'とうぶ'],
    latin: ['Tobu'],
    kanji: ['東武'],
  },
  '西武鉄道': {
    kana: ['せいぶてつどう', 'せいぶ'],
    latin: ['Seibu'],
    kanji: ['西武'],
  },
  '小田急電鉄': {
    kana: ['おだきゅうでんてつ', 'おだきゅう'],
    latin: ['Odakyu'],
    kanji: ['小田急'],
  },
  '箱根登山鉄道': {
    kana: ['はこねとざんてつどう', 'はこねとざん'],
    latin: ['Hakone Tozan'],
    kanji: ['箱根登山'],
  },
  '東急電鉄': {
    kana: ['とうきゅうでんてつ', 'とうきゅう'],
    latin: ['Tokyu'],
    kanji: ['東急', '東京急行'],
  },
  '横浜高速鉄道': {
    kana: ['よこはまこうそくてつどう', 'よこはまこうそく', 'みなとみらいせん'],
    latin: ['Minatomirai'],
    kanji: ['横浜高速', 'みなとみらい線'],
  },
  '相模鉄道': {
    kana: ['さがみてつどう', 'そうてつ'],
    latin: ['Sotetsu', 'Sagami'],
    kanji: ['相鉄', '相模'],
  },
  '埼玉高速鉄道': {
    kana: ['さいたまこうそくてつどう', 'さいたまこうそく', 'さいぞく'],
    latin: ['Saitama Railway', 'Saitama Rapid'],
    kanji: ['埼玉高速', '埼玉スタジアム線'],
  },
  '首都圏新都市鉄道': {
    kana: ['しゅとけんしんとしてつどう', 'つくばえくすぷれす', 'てぃーえっくす'],
    latin: ['TX', 'Tsukuba Express'],
    kanji: ['つくばエクスプレス', 'TX'],
  },
  '東葉高速鉄道': {
    kana: ['とうようこうそくてつどう', 'とうようこうそく', 'とうよう'],
    latin: ['Toyo Rapid'],
    kanji: ['東葉高速', '東葉'],
  },
  '関東鉄道': {
    kana: ['かんとうてつどう', 'かんとう'],
    latin: ['Kanto Railway'],
    kanji: ['関鉄', '関東'],
  },
  '流鉄': {
    kana: ['ながれやま', 'りゅうてつ', 'ながれ'],
    latin: ['Ryutetsu', 'Nagareyama'],
    kanji: ['流山'],
  },
  '小湊鉄道': {
    kana: ['こみなとてつどう', 'こみなと'],
    latin: ['Kominato'],
    kanji: ['小湊'],
  },
  'いすみ鉄道': {
    kana: ['いすみてつどう', 'いすみ'],
    latin: ['Isumi'],
    kanji: ['夷隅'],
  },
  '銚子電気鉄道': {
    kana: ['ちょうしでんきてつどう', 'ちょうしでんてつ', 'ちょうし'],
    latin: ['Choshi Electric'],
    kanji: ['銚子電鉄', '銚子'],
  },
  '鹿島臨海鉄道': {
    kana: ['かしまりんかいてつどう', 'かしまりんかい', 'かしま'],
    latin: ['Kashima Rinkai'],
    kanji: ['鹿島臨海', '鹿島'],
  },
  'ひたちなか海浜鉄道': {
    kana: ['ひたちなかかいひんてつどう', 'ひたちなか', 'かいひん'],
    latin: ['Hitachinaka Seaside'],
    kanji: ['ひたちなか', '海浜鉄道'],
  },
  '真岡鐵道': {
    kana: ['もおかてつどう', 'もうかてつどう', 'もおか', 'もうか'],
    latin: ['Moka'],
    kanji: ['真岡鉄道', '真岡'],
  },
  '宇都宮ライトレール': {
    kana: ['うつのみやらいとれーる', 'うつのみや', 'らいとれーる'],
    latin: ['Utsunomiya Light Rail', 'LRT'],
    kanji: ['宇都宮', 'ライトレール'],
  },
  '江ノ島電鉄': {
    kana: ['えのしまでんてつ', 'えのしま', 'えのでん'],
    latin: ['Enoden', 'Enoshima'],
    kanji: ['江ノ電', '江之島電鉄', '江島電'],
  },
  '伊豆箱根鉄道': {
    kana: ['いずはこねてつどう', 'いずはこね'],
    latin: ['Izuhakone'],
    kanji: ['伊豆箱根'],
  },
  '伊豆急行': {
    kana: ['いずきゅうこう', 'いずきゅう'],
    latin: ['Izukyu'],
    kanji: ['伊豆急'],
  },
  '富士急行': {
    kana: ['ふじきゅうこう', 'ふじきゅう'],
    latin: ['Fujikyu'],
    kanji: ['富士急'],
  },
  '秩父鉄道': {
    kana: ['ちちぶてつどう', 'ちちぶ'],
    latin: ['Chichibu'],
    kanji: ['秩父'],
  },
  '上毛電気鉄道': {
    kana: ['じょうもうでんきてつどう', 'じょうもうでんてつ', 'じょうもう'],
    latin: ['Joso', 'Jomo'],
    kanji: ['上毛電鉄', '上毛'],
  },
  '上信電鉄': {
    kana: ['じょうしんでんてつ', 'じょうしん'],
    latin: ['Joshin'],
    kanji: ['上信'],
  },
  'わたらせ渓谷鐵道': {
    kana: ['わたらせけいこくてつどう', 'わたらせ', 'わたてつ'],
    latin: ['Watarase Keikoku'],
    kanji: ['わたらせ渓谷鉄道', '渓谷鉄道'],
  },
  'ゆりかもめ': {
    kana: ['ゆりかもめ'],
    latin: ['Yurikamome'],
    kanji: ['東京臨海新交通臨海線'],
  },
  '横浜シーサイドライン': {
    kana: ['よこはましーさいどらいん', 'しーさいどらいん', 'しーさいど'],
    latin: ['Yokohama Seaside Line'],
    kanji: ['シーサイドライン'],
  },
  '埼玉新都市交通': {
    kana: ['さいたましんとしこうつう', 'しんとしこうつう', 'にゅーしゃとる'],
    latin: ['Saitama New Urban Transit', 'New Shuttle'],
    kanji: ['ニューシャトル', '伊奈線'],
  },
  '山万': {
    kana: ['やままん', 'ゆーかりがおかせん'],
    latin: ['Yamaman'],
    kanji: ['ユーカリが丘線'],
  },
  '東京モノレール': {
    kana: ['とうきょうものれーる', 'ものれーる'],
    latin: ['Tokyo Monorail', 'Monorail'],
    kanji: ['モノレール', '羽田空港線'],
  },
  '多摩都市モノレール': {
    kana: ['たまとしものれーる', 'たまものれーる', 'ものれーる'],
    latin: ['Tama Monorail', 'Monorail'],
    kanji: ['モノレール', '多摩モノレール'],
  },
  '千葉都市モノレール': {
    kana: ['ちばとしものれーる', 'ちばものれーる', 'ものれーる'],
    latin: ['Chiba Monorail', 'Monorail'],
    kanji: ['モノレール', '千葉モノレール'],
  },
  '湘南モノレール': {
    kana: ['しょうなんものれーる', 'ものれーる'],
    latin: ['Shonan Monorail', 'Monorail'],
    kanji: ['モノレール'],
  },
};

/** 事業者名から、検索に足す漢字略称テキストとローマ字キー（normalizeRomaji 済み・重複なし）を返す。未登録なら空。 */
export function companySearchTerms(company: string): { text: string; romaji: string[] } {
  const r = COMPANY_READINGS[company];
  if (!r) return { text: '', romaji: [] };
  const keys = new Set<string>();
  for (const k of r.kana) keys.add(normalizeRomaji(kanaToRomaji(k)));
  for (const l of r.latin ?? []) keys.add(normalizeRomaji(l));
  keys.delete('');
  return { text: (r.kanji ?? []).join(' '), romaji: [...keys] };
}
