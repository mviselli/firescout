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
| `brain/` | Python decision server: Laya-MLX, H2O-Lightning escalation |
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
