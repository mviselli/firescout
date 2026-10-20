"""One JSON line per decision, for the benchmark and for debugging prompts."""

import json
from datetime import UTC, datetime
from pathlib import Path

from firescout_brain.protocol import DecideRequest, DecisionResponse


class DecisionLog:
    def __init__(self, path: Path):
        self.path = path

    def write(self, request: DecideRequest, response: DecisionResponse) -> None:
        line = {
            "ts": datetime.now(UTC).isoformat(),
            "id": request.id,
            "unit": request.unit,
            "backend": response.backend,
            "latency_ms": response.latency_ms,
            "state": request.state,
            "questions": {
                qid: q.model_dump(mode="json", exclude_none=True)
                for qid, q in request.questions.items()
            },
            "answers": {
                qid: a.model_dump(mode="json", exclude_none=True)
                for qid, a in response.answers.items()
            },
            "usage": response.usage.model_dump(mode="json") if response.usage else None,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as f:
            f.write(json.dumps(line) + "\n")
            f.flush()
