import { describe, expect, it } from "vitest";
import { CellState, idx } from "./grid";
import { lineOfSight } from "./los";
import { buildYard } from "./map";

describe("lineOfSight", () => {
  it("is clear across open ground", () => {
    const { grid, doors } = buildYard();
    expect(lineOfSight(grid, doors, 25, 25, 40, 30)).toBe(true);
  });

  it("is blocked by a wall", () => {
    const { grid, doors } = buildYard();
    expect(lineOfSight(grid, doors, 24, 8, 28, 8)).toBe(false); // wall at x=26
  });

  it("is blocked by a closed door and clear through an open one", () => {
    const yard = buildYard();
    expect(lineOfSight(yard.grid, yard.doors, 24, 12, 28, 12)).toBe(false);
    const bWest = yard.doors.find((d) => d.id === "B-west");
    if (bWest) bWest.open = true;
    expect(lineOfSight(yard.grid, yard.doors, 24, 12, 28, 12)).toBe(true);
  });

  it("is clear through a door that has burned through", () => {
    const { grid, doors } = buildYard();
    grid.state[idx(26, 12)] = CellState.Burned;
    expect(lineOfSight(grid, doors, 24, 12, 28, 12)).toBe(true);
  });

  it("ignores what is at the endpoints", () => {
    const { grid, doors } = buildYard();
    expect(lineOfSight(grid, doors, 25, 12, 26, 12)).toBe(true); // looking at the door itself
    expect(lineOfSight(grid, doors, 25, 8, 26, 8)).toBe(true); // looking at a wall cell
  });

  it("is symmetric", () => {
    const { grid, doors } = buildYard();
    for (const [ax, ay, bx, by] of [
      [24, 8, 28, 8],
      [22, 20, 30, 10],
      [5, 30, 15, 22],
    ] as const) {
      expect(lineOfSight(grid, doors, ax, ay, bx, by)).toBe(
        lineOfSight(grid, doors, bx, by, ax, ay),
      );
    }
  });
});
