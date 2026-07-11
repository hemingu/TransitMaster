/**
 * 駅名・路線名のオートコンプリート候補生成・検索ユーティリティ。
 * UI（入力補完コンポーネント等）から利用される共有ロジックで、Network構造には依存しない。
 */

/** オートコンプリート候補1件。 */
export interface AutocompleteOption {
  /** lineIdx または stationIdx（呼び出し側の文脈で意味が決まる）。 */
  id: number;
  /** 表示文字列（例: "銀座線（東京メトロ）" / "表参道"）。 */
  label: string;
  /** 検索対象文字列。正規化前でよい（label＋補助語を含めてよい）。normalizeQuery で正規化してから比較する。 */
  searchText: string;
  /** 路線バッジ表示用の補助情報（任意）。 */
  badge?: { name: string; company: string; color: string | null };
  /**
   * 候補行に小さく添える補足テキスト（任意）。同名別駅の区別などに使う
   * （例: 駅候補に「大阪環状線（JR西日本）ほか」）。
   * filterOptions のマッチ対象には含めない（検索は searchText のみ）。
   */
  note?: string;
}

/**
 * クエリ文字列を検索用に正規化する。
 * 手順: NFKC正規化 → 空白（全角・半角とも）除去 → 小文字化。
 */
export function normalizeQuery(s: string): string {
  return s.normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();
}

/**
 * カタカナをひらがなに変換する（U+30A1〜U+30F6 を -0x60 シフト。他の文字はそのまま）。
 * normalizeQuery の NFKC ではカタカナ/ひらがなは同一視されないため、
 * カタカナ収録のふりがなをひらがな入力でもヒットさせたい場合は、
 * searchText 構築時にこの関数で変換した文字列も連結しておく。
 */
export function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 候補一覧をクエリで部分一致フィルタする。
 *
 * - query が空文字なら、options の先頭から maxResults 件をそのまま返す。
 * - query が非空なら、normalizeQuery(searchText) が query を含むものだけを残す。
 *   前方一致（normalizeQuery(searchText).startsWith(query)）を優先し、その中では
 *   元の options 配列での出現順を保つ安定ソートとする（前方一致グループ内・部分一致グループ内とも元順序維持）。
 * - 戻り値は最大 maxResults 件（デフォルト50）。
 */
export function filterOptions(
  options: AutocompleteOption[],
  query: string,
  maxResults = 50
): AutocompleteOption[] {
  const normalizedQuery = normalizeQuery(query);

  if (normalizedQuery === '') {
    return options.slice(0, maxResults);
  }

  const startsWithMatches: AutocompleteOption[] = [];
  const containsMatches: AutocompleteOption[] = [];

  for (const opt of options) {
    const normalizedSearchText = normalizeQuery(opt.searchText);
    if (!normalizedSearchText.includes(normalizedQuery)) {
      continue;
    }
    if (normalizedSearchText.startsWith(normalizedQuery)) {
      startsWithMatches.push(opt);
    } else {
      containsMatches.push(opt);
    }
  }

  // Array.prototype.push は元の配列の走査順をそのまま保つため、
  // startsWithMatches・containsMatches はそれぞれ元順序を保った安定な部分列になる。
  return [...startsWithMatches, ...containsMatches].slice(0, maxResults);
}
