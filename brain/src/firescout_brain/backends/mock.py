"""A deterministic backend for tests and offline play: no model, fixed distributions."""

from firescout_brain.backends.base import BackendResult, entropy_confidence
from firescout_brain.protocol import (
    Answer,
    ChoiceAnswer,
    ChoiceQuestion,
    NoulAnswer,
    NoulQuestion,
    Question,
    ScoreAnswer,
)

FIRST_OPTION = 0.6
NOUL_TRUE = 0.8


class MockBackend:
    name = "mock"
    model: str | None = None

    def decide(self, state: str, questions: dict[str, Question]) -> BackendResult:
        return BackendResult(
            answers={qid: _answer(q) for qid, q in questions.items()},
            usage=None,
        )


def _answer(question: Question) -> Answer:
    if isinstance(question, ChoiceQuestion):
        labels = list(question.criteria)
        if len(labels) == 1:
            probs = {labels[0]: 1.0}
        else:
            rest = (1 - FIRST_OPTION) / (len(labels) - 1)
            probs = {label: FIRST_OPTION if i == 0 else rest for i, label in enumerate(labels)}
        return ChoiceAnswer(
            type="choice",
            choice=labels[0],
            probabilities=probs,
            confidence=entropy_confidence(list(probs.values())),
            answer_confidence=max(probs.values()),
        )
    if isinstance(question, NoulQuestion):
        top = max(NOUL_TRUE, 1 - NOUL_TRUE)
        return NoulAnswer(type="noul", noul=NOUL_TRUE, confidence=top, answer_confidence=top)
    k = len(question.criteria)
    probs = {str(i): 1 / k for i in range(k)}
    return ScoreAnswer(
        type="score",
        score=(k - 1) / 2,
        probabilities=probs,
        confidence=entropy_confidence(list(probs.values())),
        answer_confidence=1 / k,
    )
