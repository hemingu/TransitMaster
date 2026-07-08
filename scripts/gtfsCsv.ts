/**
 * 最小限の CSV / GTFS 時刻ユーティリティ。
 * fs には依存しないので、テストやブラウザ非依存の文脈からもそのまま呼べる。
 */

/**
 * GTFS の CSV テキストをパースしてレコードの配列にする。
 * - 先頭の BOM を除去
 * - CRLF / LF どちらの改行にも対応
 * - ダブルクオートで囲まれたフィールド（カンマ・改行・"" エスケープを含む）に対応
 * - ヘッダ行の値をキーとして各レコードのオブジェクトを作る
 * - 各値は前後の空白を trim する
 */
export function parseCsv(text: string): Record<string, string>[] {
  // BOM除去
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF or lone CR: 次が \n ならセットで改行、なければ単独で改行扱い
      if (text[i + 1] === '\n') {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // 末尾に残ったフィールド/行を確定（末尾改行が無いケースを含む）
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // 空行（トークンが1つで空文字のみ）を除去
  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmptyRows.length === 0) return [];

  const header = nonEmptyRows[0];
  const records: Record<string, string>[] = [];
  for (let r = 1; r < nonEmptyRows.length; r++) {
    const values = nonEmptyRows[r];
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      rec[header[c]] = (values[c] ?? '').trim();
    }
    records.push(rec);
  }
  return records;
}

/**
 * GTFS の "HH:MM:SS" 形式の時刻文字列を、0時からの経過秒数に変換する。
 * HH は 24 以上（深夜運行を翌日扱いにする GTFS の慣習）になり得る。
 */
export function parseGtfsTime(time: string): number {
  const parts = time.trim().split(':');
  if (parts.length !== 3) {
    throw new Error(`invalid GTFS time: ${time}`);
  }
  const [h, m, s] = parts.map((p) => parseInt(p, 10));
  return h * 3600 + m * 60 + s;
}
