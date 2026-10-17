import { createRng } from "@firescout/sim";

// Phase 0 placeholder: confirms the sim package runs headless in Node.
const rng = createRng(1);
console.log(`bench ok, first draw for seed 1: ${rng.next()}`);
