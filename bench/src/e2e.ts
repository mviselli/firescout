import { RemotePolicy } from "@firescout/brain-client";
import { type Policy, runGame } from "@firescout/sim";

/**
 * Plays one seed twice against the live brain, with no fallback, and checks both games end with
 * the same hash: the outcome must not depend on the model's latency.
 */
function arg(argv: string[], name: string, fallback: string): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : fallback;
}

const argv = process.argv.slice(2);
const seed = Number(arg(argv, "--seed", "1"));
const url = arg(argv, "--url", "ws://127.0.0.1:8765/ws");
if (!Number.isInteger(seed) || seed < 1) throw new Error(`--seed needs a positive integer`);

const CONNECT_TIMEOUT_MS = 60_000;

async function waitOpen(remote: RemotePolicy): Promise<void> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (remote.status !== "open" || remote.backend === null) {
    if (Date.now() > deadline) throw new Error(`no brain at ${url} after ${CONNECT_TIMEOUT_MS} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const remote = new RemotePolicy({ url, fallback: null });
let failed = false;
try {
  await waitOpen(remote);
  console.log(`brain: ${remote.backend} at ${url}`);
  const hashes: string[] = [];
  for (let run = 1; run <= 2; run++) {
    const latencies: number[] = [];
    const timed: Policy = {
      name: remote.name,
      async decide(req) {
        const answers = await remote.decide(req);
        if (remote.lastMeta) latencies.push(remote.lastMeta.latencyMs);
        return answers;
      },
    };
    const start = performance.now();
    const result = await runGame({ seed }, timed);
    const wall = (performance.now() - start) / 1000;
    const mean = latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length);
    hashes.push(result.hash);
    console.log(
      `run ${run}: seed ${seed}, ${result.decisions} decisions, hash ${result.hash}, ` +
        `${wall.toFixed(1)} s wall, mean latency ${mean.toFixed(0)} ms, saved ${result.savedFraction.toFixed(3)}`,
    );
  }
  if (hashes[0] !== hashes[1]) {
    console.error(`FAIL: hashes differ (${hashes.join(" vs ")})`);
    failed = true;
  } else {
    console.log("OK: same hash twice");
  }
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  failed = true;
} finally {
  remote.close();
}
process.exit(failed ? 1 : 0);
