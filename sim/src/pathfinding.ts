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

/** Writes the 4 neighbours of `i` into `out` (up, left, right, down), -1 off the grid. */
function neighbours(i: number, out: Int32Array): void {
  const x = i % W;
  const y = (i - x) / W;
  out[0] = y > 0 ? i - W : -1;
  out[1] = x > 0 ? i - 1 : -1;
  out[2] = x < W - 1 ? i + 1 : -1;
  out[3] = y < H - 1 ? i + W : -1;
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
  const nbrs = new Int32Array(4);
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
    const gi = (g[i] as number) + 1;
    neighbours(i, nbrs);
    for (let k = 0; k < 4; k++) {
      const n = nbrs[k] as number;
      if (n < 0 || closed[n] || gi >= (g[n] as number) || !passable(n)) continue;
      g[n] = gi;
      from[n] = i;
      const h = heuristic(n);
      open.push([gi + h, h, n]);
    }
  }
  return null;
}

/**
 * Dijkstra from `start` on the 4-connected grid, where entering cell `i` costs `cost(i)`.
 * Returns the cost to reach every cell and its predecessor on a cheapest route (Infinity and -1
 * when unreachable). Ties go to the lower cell index, so the result is deterministic.
 */
export function costMap(
  start: number,
  passable: (i: number) => boolean,
  cost: (i: number) => number,
): { dist: Float64Array; from: Int32Array } {
  const dist = new Float64Array(N).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new Heap();
  const nbrs = new Int32Array(4);
  dist[start] = 0;
  open.push([0, 0, start]);

  while (open.size > 0) {
    const [, , i] = open.pop() as Entry;
    if (closed[i]) continue;
    closed[i] = 1;
    neighbours(i, nbrs);
    for (let k = 0; k < 4; k++) {
      const n = nbrs[k] as number;
      if (n < 0 || closed[n] || !passable(n)) continue;
      const d = (dist[i] as number) + cost(n);
      if (d >= (dist[n] as number)) continue;
      dist[n] = d;
      from[n] = i;
      open.push([d, 0, n]);
    }
  }
  return { dist, from };
}
