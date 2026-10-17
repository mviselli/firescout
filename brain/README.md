# firescout-brain

Local decision server for FireScout: Laya-MLX (System 1) with escalation to H2O-Lightning-4B (System 2).

```sh
uv sync
uv run pytest            # fast tests
uv run pytest -m model   # tests that load the Laya checkpoint
uv run python scripts/laya_spike.py   # format + latency check
```
