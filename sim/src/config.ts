/** Every tunable number of the simulation. Balancing should only need to touch this file. */
export const SIM = {
  /** Simulated seconds per tick. */
  TICK: 0.1,

  // Fire (fire.ts)
  /** Base ignition probability per neighbour per tick, before fuel/intensity/wind factors. */
  SPREAD_BASE: 0.06,
  /** How strongly wind alignment multiplies spread: (1 + WIND_K × align). */
  WIND_K: 1.5,
  /** Wind speed at which alignment reaches full strength. */
  WIND_REF_KMH: 30,
  DIAGONAL_WEIGHT: 0.7,
  /** Intensity gained per tick, scaled by the cell type's initial fuel. */
  GROWTH: 0.05,
  /** Fuel consumed per tick at intensity 1. */
  BURN_RATE: 0.02,
  /** Intensity of a cell ignited by spread. */
  IGNITION_INTENSITY: 0.1,

  // Smoke (smoke.ts)
  /** Smoke added per tick by a burning cell at intensity 1. */
  SMOKE_EMIT: 0.05,
  /** Fraction of the gap to the neighbours' mean closed per tick. */
  SMOKE_DIFFUSION: 0.2,
  SMOKE_DECAY_INDOOR: 0.002,
  SMOKE_DECAY_OUTDOOR: 0.05,
} as const;
