import { SIM } from "./config";
import type { DecisionContext, FireSector } from "./context";
import type { Wind } from "./world";

/** Compass points counter-clockwise from east, 45 degrees apart (north is -y). */
const COMPASS = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"] as const;

function compass(dx: number, dy: number): string {
  const k = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4));
  return COMPASS[((k % 8) + 8) % 8] as string;
}

function windLine(w: Wind): string {
  return `wind: from ${compass(-w.dx, -w.dy)} to ${compass(w.dx, w.dy)}, ${Math.round(w.speedKmh)} km/h`;
}

function firesHeader(count: number): string {
  if (count === 0) return "fires: none";
  const burning = `${count} ${count === 1 ? "sector" : "sectors"} burning`;
  return count > SIM.TOP_FIRES ? `fires: ${burning}, top ${SIM.TOP_FIRES}:` : `fires: ${burning}:`;
}

function fireLine(f: FireSector): string {
  const doors = f.doors.length > 0 ? f.doors.join(",") : "none";
  return (
    `  ${f.sector} ${f.content} ${f.burning} cells int=${f.meanIntensity.toFixed(2)} ` +
    `dist=${f.dist} doors=${doors}`
  );
}

/** The compact English state the model reads: the robot, the top fires, a door ahead, the wind. */
export function serializeState(ctx: DecisionContext): string {
  const { robot } = ctx;
  const lines = [
    `t=${ctx.t.toFixed(1)}s unit=R1 sector=${robot.sector} task=${robot.task} ` +
      `water=${robot.water}% foam=${robot.foam}%`,
    firesHeader(ctx.fires.length),
    ...ctx.fires.slice(0, SIM.TOP_FIRES).map(fireLine),
  ];
  if (ctx.door) {
    lines.push(
      `door ahead: ${ctx.door.id}, smoke behind it ${ctx.door.smoke.toFixed(2)}, ` +
        `backdraft risk above ${SIM.DOOR_SMOKE_THRESHOLD.toFixed(2)}`,
    );
  }
  lines.push(windLine(ctx.wind));
  return lines.join("\n");
}
