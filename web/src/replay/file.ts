import { AnswerSchema } from "@firescout/brain-client";
import type { DecisionReason, Recording } from "@firescout/sim";
import { z } from "zod";

/** A replay file that cannot be opened; the message is one line for the HUD. */
export class RecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingError";
  }
}

const MAX_CHARS = 5 * 1024 * 1024;
/** One decision per tick at most, over the longest allowed game. */
const MAX_DECISIONS = 40_000;

const REASONS = [
  "start",
  "cadence",
  "task_done",
  "tank_empty",
  "door",
  "blocked",
  "refilled",
] as const satisfies readonly DecisionReason[];
/** Fails to compile if the sim gains a decision reason this list lacks. */
const _allReasons: Exclude<DecisionReason, (typeof REASONS)[number]> extends never ? true : never =
  true;

const SourceSchema = z.strictObject({
  backend: z.string().min(1).max(40),
  latencyMs: z.number().min(0).optional(),
  fallback: z.string().max(200).optional(),
});

const DecisionSchema = z.strictObject({
  id: z.number().int().min(1),
  t: z.number().min(0),
  tick: z.number().int().min(0),
  reason: z.enum(REASONS),
  answers: z.record(z.string(), AnswerSchema),
  source: SourceSchema.optional(),
});

const RecordingSchema = z
  .strictObject({
    version: z.literal(1),
    options: z.strictObject({
      seed: z.number().int().min(0),
      wind: z
        .strictObject({ dx: z.number(), dy: z.number(), speedKmh: z.number().min(0) })
        .optional(),
      ignitions: z.number().int().min(1).max(10).optional(),
      maxTime: z.number().min(1).max(3600).optional(),
    }),
    policy: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    decisions: z.array(DecisionSchema).max(MAX_DECISIONS),
    end: z.strictObject({
      tick: z.number().int().min(0),
      hash: z.string().regex(/^[0-9a-f]{8}$/),
    }),
  })
  .superRefine((rec, ctx) => {
    let prevTick = 0;
    rec.decisions.forEach((d, k) => {
      if (d.id !== k + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["decisions", k, "id"],
          message: `expected ${k + 1}`,
        });
      }
      if (d.tick < prevTick || d.tick > rec.end.tick) {
        ctx.addIssue({
          code: "custom",
          path: ["decisions", k, "tick"],
          message: `out of order or past the end (tick ${d.tick})`,
        });
      }
      prevTick = d.tick;
    });
  });

export function recordingFileName(rec: Recording): string {
  return `firescout-fire-${rec.options.seed}-${rec.policy}.json`;
}

export function serializeRecording(rec: Recording): string {
  return JSON.stringify(rec);
}

/** A validated recording, or a RecordingError saying in one line what is wrong. */
export function parseRecording(text: string): Recording {
  if (text.length > MAX_CHARS) throw new RecordingError("Replay file is too large (over 5 MB).");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RecordingError("Not a FireScout replay (not JSON).");
  }
  if (typeof raw === "object" && raw !== null && "version" in raw && raw.version !== 1) {
    throw new RecordingError(
      `Replay version ${String(raw.version)} is not supported (expected 1).`,
    );
  }
  const parsed = RecordingSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "file";
    const message = (issue?.message ?? "invalid").replace(/\.$/, "");
    throw new RecordingError(`Not a valid FireScout replay: ${path}: ${message}.`);
  }
  // The schema matches Recording; zod types absent optionals as `T | undefined`, which
  // exactOptionalPropertyTypes keeps apart from a missing key.
  return parsed.data as Recording;
}
