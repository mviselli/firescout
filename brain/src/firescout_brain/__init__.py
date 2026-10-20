"""FireScout decision server. Run with: uv run firescout-brain [--backend laya|mock]"""

import argparse
import logging
from pathlib import Path

from firescout_brain.backends.laya import DEFAULT_MODEL


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="firescout-brain", description=__doc__)
    p.add_argument("--backend", choices=["laya", "mock"], default="laya")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--log", type=Path, default=Path("logs/decisions.jsonl"))
    return p.parse_args(argv)


def main() -> None:
    import uvicorn

    from firescout_brain.backends import DecisionBackend, LayaBackend, MockBackend
    from firescout_brain.log import DecisionLog
    from firescout_brain.server import create_app

    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    # Build the backend before serving: Laya takes ~13 s to load.
    backend: DecisionBackend = (
        MockBackend() if args.backend == "mock" else LayaBackend(model_id=args.model)
    )
    uvicorn.run(create_app(backend, DecisionLog(args.log)), host=args.host, port=args.port)
