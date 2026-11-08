/**
 * 数値キー付きの2分最小ヒープ（Dijkstra 用）。
 * 値は整数（ノードid等）。同キーの取り出し順は不定。
 */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      vals[i] = vals[parent];
      i = parent;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** 最小キーの要素を取り出す。空なら undefined。 */
  pop(): { key: number; val: number } | undefined {
    const keys = this.keys;
    const vals = this.vals;
    const n = keys.length;
    if (n === 0) return undefined;
    const topKey = keys[0];
    const topVal = vals[0];
    const lastKey = keys.pop()!;
    const lastVal = vals.pop()!;
    const m = n - 1;
    if (m > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= m) break;
        if (child + 1 < m && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        keys[i] = keys[child];
        vals[i] = vals[child];
        i = child;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return { key: topKey, val: topVal };
  }
}
