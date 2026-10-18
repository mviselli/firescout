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

  // Robot R1 (robot.ts)
  /** Ticks per cell moved (0.3 s). */
  ROBOT_MOVE_TICKS: 3,
  /** Tank capacity for water and foam. */
  TANK: 100,
  /** Jet range in cells (Chebyshev), line of sight required. */
  SPRAY_RANGE: 3,
  /** Intensity removed per tick from each sprayed cell, before effectiveness. */
  SPRAY_POWER: 0.15,
  /** Tank units used per spraying tick. */
  SPRAY_USE: 1,
  /** Tank units refilled per tick on the base. */
  REFILL_RATE: 5,
  /** Agent effectiveness by fire class: A solids, B liquids (EN 2). */
  EFFECTIVENESS: { water: { A: 1, B: 0.2 }, foam: { A: 0.6, B: 1 } },
  /** Chance per tick that water on burning paint splashes the fire to a neighbour. */
  WATER_ON_PAINT_SPREAD: 0.25,

  // Doors (robot.ts)
  /** Smoke behind a door at or above which opening it causes a backdraft. */
  DOOR_SMOKE_THRESHOLD: 0.6,
  BACKDRAFT_RADIUS: 2,
  BACKDRAFT_INTENSITY: 0.9,
  BACKDRAFT_STUN_TICKS: 30,
  BACKDRAFT_WATER_LOSS: 20,
  /** Ticks a door judged unsafe is left alone before the robot may try it again. */
  DOOR_HOLD_TICKS: 30,

  // Decisions (context.ts)
  /** Distance (cells) at which a fire's priority is halved. */
  PRIORITY_DIST_SCALE: 16,
  /** Fire sectors offered as attack options. */
  TOP_FIRES: 3,
} as const;
