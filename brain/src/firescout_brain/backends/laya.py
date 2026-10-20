"""Laya-MLX, the local System 1 model."""

import logging
from typing import Any

from pydantic import TypeAdapter

from firescout_brain.backends.base import BackendResult
from firescout_brain.protocol import Answer, Question, Usage

DEFAULT_MODEL = "aac6fef/laya-mlx"

# Laya answer fields that the wire format does not carry.
_DROPPED = ("action", "legend")

_ANSWER: TypeAdapter[Answer] = TypeAdapter(Answer)
log = logging.getLogger("firescout_brain")


class LayaBackend:
    name = "laya"

    def __init__(self, model_id: str = DEFAULT_MODEL, agent: Any | None = None):
        self.model: str | None = model_id
        if agent is None:
            from laya_mlx import load

            agent = load(model_id)
        self._agent = agent

    def decide(self, state: str, questions: dict[str, Question]) -> BackendResult:
        payload = {qid: q.model_dump(exclude_none=True) for qid, q in questions.items()}
        out = self._agent.predict(state, payload)

        answers: dict[str, Answer] = {}
        for qid in questions:
            raw = {k: v for k, v in out["answers"][qid].items() if k not in _DROPPED}
            answers[qid] = _ANSWER.validate_python(raw)

        raw_usage = out.get("usage")
        usage = None
        if raw_usage is not None:
            usage = Usage(
                state_tokens=raw_usage["state_tokens"],
                state_tokens_dropped=raw_usage["state_tokens_dropped"],
                truncated_questions=list(raw_usage["truncated_questions"]),
            )
            if usage.state_tokens_dropped > 0:
                log.warning(
                    "laya dropped %d state tokens (truncated questions: %s)",
                    usage.state_tokens_dropped,
                    usage.truncated_questions,
                )
            if "options" in raw_usage:
                log.warning("laya collapsed options: %s", raw_usage["options"])
        return BackendResult(answers=answers, usage=usage)
