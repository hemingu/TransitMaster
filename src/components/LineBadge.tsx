// 路線名に応じてバッジの色を安定的に割り当てる（ハッシュベース、依存追加なし）
// color（データ由来の路線カラー）が無い場合のフォールバックとして使う。
const BADGE_COLORS = [
  '#e60012', // 赤（山手線イメージ）
  '#f68b1e', // 中央線イメージ
  '#0089d0', // 丸ノ内線イメージ
  '#00a960',
  '#9b7cb6',
  '#00acd7',
  '#e85298',
  '#8fc31f',
];

function colorForLine(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}

/** #RRGGBB（#なし可）から相対輝度を求め、白背景に適した文字色（白/黒）を返す。 */
function textColorForBackground(hex: string): string {
  const normalized = hex.replace(/^#/, '');
  if (normalized.length !== 6) return '#fff';
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.5 ? '#08060d' : '#fff';
}

interface LineBadgeProps {
  name: string;
  company: string;
  color: string | null;
}

export function LineBadge({ name, company, color }: LineBadgeProps) {
  const background = color ? `#${color}` : colorForLine(name);
  const textColor = textColorForBackground(background.replace(/^#/, ''));

  return (
    <span className="line-badge" style={{ background, color: textColor }}>
      {name}
      <span className="line-badge-company">{company}</span>
    </span>
  );
}
