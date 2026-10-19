import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClientMessageSchema, ServerMessageSchema } from "./protocol";

const root = join(import.meta.dirname, "../../shared/fixtures/protocol");

function fixtures(kind: "valid" | "invalid"): [string, unknown][] {
  const dir = join(root, kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]);
}

describe("protocol fixtures", () => {
  it("has fixtures on both sides", () => {
    expect(fixtures("valid").length).toBeGreaterThan(0);
    expect(fixtures("invalid").length).toBeGreaterThan(0);
  });

  it.each(fixtures("valid"))("parses and round-trips %s", (_, raw) => {
    const schema =
      (raw as { type: string }).type === "decide" ? ClientMessageSchema : ServerMessageSchema;
    expect(schema.parse(raw)).toEqual(raw);
  });

  it.each(fixtures("invalid"))("rejects %s", (_, raw) => {
    expect(ClientMessageSchema.safeParse(raw).success).toBe(false);
    expect(ServerMessageSchema.safeParse(raw).success).toBe(false);
  });
});
