# FireScout

A recon drone and a tracked firefighting robot put out a fire in a simulated industrial yard.
Neither is driven by a language model: **a decision model decides, a deterministic controller executes.**

> Work in progress.

## Layout

| Path | What |
|---|---|
| `sim/` | Pure TypeScript simulation (seeded, no DOM): grid, fire, smoke, units, controllers |
| `web/` | Vite + three.js scene and HUD |
| `bench/` | Headless runner: N seeds × policy → logs and charts |
| `brain-client/` | WebSocket protocol (zod) and the `RemotePolicy` used by `web` and `bench` |
| `brain/` | Python decision server (FastAPI + WebSocket) running Laya-MLX locally |
| `shared/` | JSON fixtures that pin the protocol and the model's prompts on both sides |
| `docs/` | Notes and results |

## Requirements

macOS on Apple silicon (for MLX), Node 22+, pnpm 10, [uv](https://docs.astral.sh/uv/).

## Commands

```sh
pnpm install
pnpm dev         # web demo
pnpm test        # TypeScript tests
pnpm typecheck
pnpm lint
pnpm bench

cd brain
uv sync
uv run pytest
```

## Play with Laya

The robot's decisions come from Laya-MLX, running locally in `brain/`. Start the brain, then the web demo:

```sh
cd brain && uv run firescout-brain       # loads Laya (~15 s), listens on ws://127.0.0.1:8765/ws
pnpm dev                                 # in another terminal, then open http://localhost:5173
```

The panel says who decided R1's last move: `Laya · 300 ms`, or `Brain offline, baseline rules` when the brain is
not running (the game keeps going on the hand-written rules and switches back when the brain returns). The select
next to the fire name switches between Laya and the rules on the same seed. `uv run firescout-brain --backend mock`
starts a model-free brain for testing; `VITE_BRAIN_URL` points the web demo at another address. Every decision is
appended to `brain/logs/decisions.jsonl`.

`pnpm --filter @firescout/bench e2e --seed 1` plays one seed twice against the running brain and checks that both
games end in the same state, whatever the model's latency.

![R1 driven by Laya, falling back to the rules while the brain is stopped](docs/media/phase2.gif)
