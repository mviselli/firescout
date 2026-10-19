import { describe, expect, it } from "vitest";
import type { DecisionContext, FireSector } from "./context";
import { serializeState } from "./serialize";

function fire(sector: string, over: Partial<FireSector> = {}): FireSector {
  return {
    sector,
    building: null,
    content: "scrub",
    burning: 1,
    meanIntensity: 0.5,
    maxIntensity: 0.5,
    dist: 10,
    doors: [],
    ...over,
  };
}

function context(over: Partial<DecisionContext> = {}): DecisionContext {
  return {
    t: 18.4,
    reason: "cadence",
    robot: { sector: "E4", water: 62, foam: 88, task: "attack" },
    fires: [
      fire("B5", {
        building: "B",
        content: "paint",
        burning: 12,
        meanIntensity: 0.81,
        dist: 9,
        doors: ["B-south"],
      }),
      fire("B3", {
        building: "A",
        content: "paper",
        burning: 3,
        meanIntensity: 0.4,
        dist: 19,
        doors: ["A-south", "A-inner"],
      }),
      fire("A1", { burning: 6, meanIntensity: 0.8, dist: 60 }),
      fire("A2"),
      fire("A3"),
    ],
    wind: { dx: 1, dy: 0, speedKmh: 18 },
    door: { id: "B-south", smoke: 0.71 },
    ...over,
  };
}

describe("serializeState", () => {
  it("serializes a context in the exact format", () => {
    expect(serializeState(context())).toBe(
      [
        "t=18.4s unit=R1 sector=E4 task=attack water=62% foam=88%",
        "fires: 5 sectors burning, top 3:",
        "  B5 paint 12 cells int=0.81 dist=9 doors=B-south",
        "  B3 paper 3 cells int=0.40 dist=19 doors=A-south,A-inner",
        "  A1 scrub 6 cells int=0.80 dist=60 doors=none",
        "door ahead: B-south, smoke behind it 0.71, backdraft risk above 0.60",
        "wind: from W to E, 18 km/h",
      ].join("\n"),
    );
  });

  it("says fires: none with no fires", () => {
    const lines = serializeState(context({ fires: [], door: null })).split("\n");
    expect(lines[1]).toBe("fires: none");
    expect(lines).toHaveLength(3);
  });

  it("lists at most TOP_FIRES sectors and counts the rest", () => {
    const two = serializeState(context({ fires: [fire("A1"), fire("A2")], door: null }));
    expect(two.split("\n").slice(1, 4)).toEqual([
      "fires: 2 sectors burning:",
      "  A1 scrub 1 cells int=0.50 dist=10 doors=none",
      "  A2 scrub 1 cells int=0.50 dist=10 doors=none",
    ]);
    const one = serializeState(context({ fires: [fire("A1")], door: null }));
    expect(one.split("\n")[1]).toBe("fires: 1 sector burning:");
    const five = serializeState(context()).split("\n");
    expect(five.filter((l) => l.startsWith("  "))).toHaveLength(3);
    expect(five.some((l) => l.includes("A2"))).toBe(false);
  });

  it("adds the door line only for a door ahead", () => {
    expect(serializeState(context())).toContain("door ahead: B-south");
    expect(serializeState(context({ door: null }))).not.toContain("door ahead");
  });

  it("names the wind for all 8 directions", () => {
    const d = Math.SQRT1_2;
    const cases: [number, number, string][] = [
      [1, 0, "from W to E"],
      [d, -d, "from SW to NE"],
      [0, -1, "from S to N"],
      [-d, -d, "from SE to NW"],
      [-1, 0, "from E to W"],
      [-d, d, "from NE to SW"],
      [0, 1, "from N to S"],
      [d, d, "from NW to SE"],
    ];
    for (const [dx, dy, text] of cases) {
      const s = serializeState(context({ wind: { dx, dy, speedKmh: 12 } }));
      expect(s.split("\n").at(-1)).toBe(`wind: ${text}, 12 km/h`);
    }
  });

  it("is pure ASCII", () => {
    const text = serializeState(context());
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
    expect(text.endsWith("\n")).toBe(false);
  });
});
