import { z } from "zod";

/**
 * The browser/bench ↔ brain wire protocol. Mirrored by `brain/src/firescout_brain/protocol.py`;
 * both are pinned by the JSON files in `shared/fixtures/protocol/`.
 */

const MAX_OPTIONS = 10;
const unit = z.number().min(0).max(1);
const id = z.number().int().min(1);

/** A record with between `min` and `max` keys. */
function sized<T extends z.ZodType>(value: T, min: number, max: number) {
  return z.record(z.string(), value).refine((r) => {
    const n = Object.keys(r).length;
    return n >= min && n <= max;
  }, `expected ${min} to ${max} entries`);
}

export const QuestionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("choice"),
    instructions: z.string(),
    criteria: sized(z.string(), 1, MAX_OPTIONS),
  }),
  z.strictObject({ type: z.literal("noul"), instructions: z.string() }),
  z.strictObject({
    type: z.literal("score"),
    instructions: z.string(),
    criteria: z.array(z.string()).min(2).max(MAX_OPTIONS),
  }),
]);

export const DecideRequestSchema = z.strictObject({
  type: z.literal("decide"),
  id,
  unit: z.literal("R1"),
  state: z.string().min(1).max(4000),
  questions: sized(QuestionSchema, 1, Number.POSITIVE_INFINITY),
});

export const AnswerSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), unit),
    confidence: unit,
    answer_confidence: unit.optional(),
  }),
  z.strictObject({
    type: z.literal("noul"),
    noul: unit,
    confidence: unit,
    answer_confidence: unit.optional(),
  }),
  z.strictObject({
    type: z.literal("score"),
    score: z.number().min(0),
    probabilities: z.record(z.string(), unit),
    confidence: unit,
    answer_confidence: unit.optional(),
  }),
]);

export const UsageSchema = z.strictObject({
  state_tokens: z.number().int().min(0),
  state_tokens_dropped: z.number().int().min(0),
  truncated_questions: z.array(z.string()),
});

export const DecisionResponseSchema = z.strictObject({
  type: z.literal("decision"),
  id,
  backend: z.string(),
  escalated: z.boolean(),
  latency_ms: z.number().min(0),
  answers: z.record(z.string(), AnswerSchema),
  usage: UsageSchema.nullable(),
});

export const ErrorResponseSchema = z.strictObject({
  type: z.literal("error"),
  id: id.nullable(),
  message: z.string(),
});

export const HelloSchema = z.strictObject({
  type: z.literal("hello"),
  protocol: z.literal(1),
  backend: z.string(),
  model: z.string().nullable(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [DecideRequestSchema]);
export const ServerMessageSchema = z.discriminatedUnion("type", [
  DecisionResponseSchema,
  ErrorResponseSchema,
  HelloSchema,
]);

export type Question = z.infer<typeof QuestionSchema>;
export type DecideRequest = z.infer<typeof DecideRequestSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type Hello = z.infer<typeof HelloSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
