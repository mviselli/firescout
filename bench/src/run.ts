import { BaselinePolicy, type GameResult, IdlePolicy, type Policy, runGame } from "@firescout/sim";

function parseSeeds(argv: string[]): number {
  const i = argv.indexOf("--seeds");
  const n = i >= 0 ? Number(argv[i + 1]) : 10;
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--seeds needs a positive integer, got ${argv[i + 1]}`);
  return n;
}

function meanSd(values: number[]): string {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return `${mean.toFixed(3)} ± ${sd.toFixed(3)}`;
}

const seeds = parseSeeds(process.argv.slice(2));
const policies: Policy[] = [new IdlePolicy(), new BaselinePolicy()];
const rows: string[][] = [["policy", "saved", "t (s)", "wrongAgent"]];

for (const policy of policies) {
  const results: GameResult[] = [];
  for (let seed = 1; seed <= seeds; seed++) results.push(await runGame({ seed }, policy));
  rows.push([
    policy.name,
    meanSd(results.map((r) => r.savedFraction)),
    meanSd(results.map((r) => r.t)),
    meanSd(results.map((r) => r.wrongAgent)),
  ]);
}

const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => r[c]?.length ?? 0))) ?? [];
console.log(`seeds 1..${seeds}`);
for (const r of rows) console.log(r.map((cell, c) => cell.padEnd(widths[c] ?? 0)).join("  "));
