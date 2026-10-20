"""What every decision backend returns, and the confidence rule they share with Laya."""

import math
from dataclasses import dataclass
from typing import Protocol

from firescout_brain.protocol import Answer, Question, Usage


@dataclass(frozen=True)
class BackendResult:
    answers: dict[str, Answer]
    usage: Usage | None


class DecisionBackend(Protocol):
    name: str
    model: str | None

    def decide(self, state: str, questions: dict[str, Question]) -> BackendResult: ...


def entropy_confidence(probabilities: list[float]) -> float:
    """Laya's choice/score confidence: 1 - H(p)/log k, so 0 is a uniform guess."""
    k = len(probabilities)
    if k < 2:
        return 1.0
    entropy = -sum(p * math.log(p) for p in probabilities if p > 0)
    return max(0.0, 1 - entropy / math.log(k))
