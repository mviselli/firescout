import { describe, expect, it } from "vitest";
import { idx, inBounds, W, xy } from "./grid";
import { findPath } from "./pathfinding";

const manhattanTo = (goal: number) => (i: number) => {
  const [x, y] = xy(i);
  const [gx, gy] = xy(goal);
  return Math.abs(x - gx) + Math.abs(y - gy);
};

const open = () => true;

function expectContiguous(start: number, path: number[]): void {
  let prev = start;
  for (const i of path) {
    const [px, py] = xy(prev);
    const [x, y] = xy(i);
    expect(Math.abs(px - x) + Math.abs(py - y)).toBe(1);
    expect(inBounds(x, y)).toBe(true);
    prev = i;
  }
}

describe("findPath", () => {
  it("returns the shortest path length on open ground", () => {
    const start = idx(30, 25);
    const goal = idx(40, 25);
    const path = findPath(start, (i) => i === goal, open, manhattanTo(goal));
    expect(path).not.toBeNull();
    expect(path?.length).toBe(10);
    expect(path?.at(-1)).toBe(goal);
    expectContiguous(start, path ?? []);
  });

  it("routes around a wall", () => {
    // vertical wall at x = 35, y 15..35, gap above y = 15
    const wall = new Set<number>();
    for (let y = 15; y <= 35; y++) wall.add(idx(35, y));
    const start = idx(30, 25);
    const goal = idx(40, 25);
    const path = findPath(
      start,
      (i) => i === goal,
      (i) => !wall.has(i),
      manhattanTo(goal),
    );
    expect(path).not.toBeNull();
    for (const i of path ?? []) expect(wall.has(i)).toBe(false);
    expect(path?.length).toBe(10 + 2 * 11); // detour over the top end at y = 14
    expectContiguous(start, path ?? []);
  });

  it("returns null when the goal is enclosed", () => {
    const goal = idx(20, 20);
    const ring = new Set([idx(19, 20), idx(21, 20), idx(20, 19), idx(20, 21)]);
    const path = findPath(
      idx(5, 5),
      (i) => i === goal,
      (i) => !ring.has(i),
      manhattanTo(goal),
    );
    expect(path).toBeNull();
  });

  it("returns [] when the start is already a goal", () => {
    const start = idx(3, 3);
    expect(
      findPath(
        start,
        (i) => i === start,
        open,
        () => 0,
      ),
    ).toEqual([]);
  });

  it("accepts any goal cell from a predicate", () => {
    const start = idx(10, 10);
    const path = findPath(
      start,
      (i) => xy(i)[0] === 15,
      open,
      (i) => Math.max(0, 15 - xy(i)[0]),
    );
    expect(path?.length).toBe(5);
  });

  it("is deterministic among equal-length paths", () => {
    const start = idx(10, 10);
    const goal = idx(20, 20);
    const a = findPath(start, (i) => i === goal, open, manhattanTo(goal));
    const b = findPath(start, (i) => i === goal, open, manhattanTo(goal));
    expect(a).toEqual(b);
  });

  it("never steps outside the grid", () => {
    const start = idx(0, 0);
    const goal = idx(W - 1, 0);
    const path = findPath(start, (i) => i === goal, open, manhattanTo(goal));
    expect(path?.length).toBe(W - 1);
    expectContiguous(start, path ?? []);
  });
});
