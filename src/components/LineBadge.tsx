// 路線名に応じてバッジの色を安定的に割り当てる（ハッシュベース、依存追加なし）
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

interface LineBadgeProps {
  name: string;
}

export function LineBadge({ name }: LineBadgeProps) {
  return (
    <span className="line-badge" style={{ background: colorForLine(name) }}>
      {name}
    </span>
  );
}
