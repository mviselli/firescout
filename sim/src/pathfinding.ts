import { H, N, W } from "./grid";

type Entry = readonly [f: number, h: number, cell: number];

function less(a: Entry, b: Entry): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
}

/** Min-heap of [f, h, cell] ordered lexicographically, which makes tie-breaking deterministic. */
class Heap {
  private items: Entry[] = [];

  get size(): number {
    return this.items.length;
  }

  private at(i: number): Entry {
    return this.items[i] as Entry;
  }

  private swap(i: number, j: number): void {
    const t = this.at(i);
    this.items[i] = this.at(j);
    this.items[j] = t;
  }

  push(item: Entry): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(this.at(i), this.at(p))) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): Entry | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length === 0 || last === undefined) return top;
    this.items[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.items.length && less(this.at(l), this.at(m))) m = l;
      if (r < this.items.length && less(this.at(r), this.at(m))) m = r;
      if (m === i) return top;
      this.swap(i, m);
      i = m;
    }
  }
}

/**
 * A* on the 4-connected grid with unit step cost. Returns the cells to walk, excluding `start`
 * and ending on a goal; `[]` if `start` is a goal; `null` if no goal is reachable.
 * `passable` is not checked for `start`.
 */
export function findPath(
  start: number,
  isGoal: (i: number) => boolean,
  passable: (i: number) => boolean,
  heuristic: (i: number) => number,
): number[] | null {
  if (isGoal(start)) return [];
  const g = new Float64Array(N).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new Heap();
  g[start] = 0;
  open.push([heuristic(start), heuristic(start), start]);

  while (open.size > 0) {
    const [, , i] = open.pop() as Entry;
    if (closed[i]) continue;
    if (isGoal(i)) {
      const path: number[] = [];
      for (let c = i; c !== start; c = from[c] as number) path.push(c);
      return path.reverse();
    }
    closed[i] = 1;
    const x = i % W;
    const y = (i - x) / W;
    const gi = (g[i] as number) + 1;
    for (const n of [
      y > 0 ? i - W : -1,
      x > 0 ? i - 1 : -1,
      x < W - 1 ? i + 1 : -1,
      y < H - 1 ? i + W : -1,
    ]) {
      if (n < 0 || closed[n] || gi >= (g[n] as number) || !passable(n)) continue;
      g[n] = gi;
      from[n] = i;
      const h = heuristic(n);
      open.push([gi + h, h, n]);
    }
  }
  return null;
}
