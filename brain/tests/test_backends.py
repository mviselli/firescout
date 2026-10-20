import copy
import json
import logging
import math
from pathlib import Path

import pytest

from firescout_brain.backends import BackendResult, DecisionBackend, LayaBackend, MockBackend
from firescout_brain.protocol import (
    CLIENT_MESSAGE,
    ChoiceAnswer,
    ChoiceQuestion,
    NoulAnswer,
    ScoreAnswer,
    ScoreQuestion,
)

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "protocol" / "valid"


def load_request(name: str):
    return CLIENT_MESSAGE.validate_python(json.loads((FIXTURES / name).read_text()))


ACTION = load_request("decide-action.json")
DOOR = load_request("decide-door.json")

# `agent.predict` output recorded from the real checkpoint on decide-action.json,
# plus a door and a score question.
RECORDED = {
    "model": "laya-rl-agent",
    "answers": {
        "action": {
            "type": "choice",
            "confidence": 0.0742,
            "answer_confidence": 0.3172,
            "action": {"act_probability": 1.0},
            "choice": "attack_A1",
            "probabilities": {
                "attack_A1": 0.3172,
                "attack_B5": 0.1873,
                "attack_C2": 0.1794,
                "refill": 0.0511,
                "wait": 0.265,
            },
        },
        "agent_A1": {
            "type": "choice",
            "confidence": 0.0959,
            "answer_confidence": 0.6803,
            "action": {"act_probability": 1.0},
            "choice": "water",
            "probabilities": {"water": 0.6803, "foam": 0.3197},
        },
        "agent_B5": {
            "type": "choice",
            "confidence": 0.0435,
            "answer_confidence": 0.6222,
            "action": {"act_probability": 1.0},
            "choice": "water",
            "probabilities": {"water": 0.6222, "foam": 0.3778},
        },
        "agent_C2": {
            "type": "choice",
            "confidence": 0.2504,
            "answer_confidence": 0.7857,
            "action": {"act_probability": 1.0},
            "choice": "water",
            "probabilities": {"water": 0.7857, "foam": 0.2143},
        },
        "door_safe": {
            "type": "noul",
            "confidence": 0.8052,
            "answer_confidence": 0.8052,
            "action": {"act_probability": 1.0},
            "noul": 0.1948,
        },
        "spread": {
            "type": "score",
            "confidence": 0.0639,
            "answer_confidence": 0.5008,
            "action": {"act_probability": 1.0},
            "score": 0.897,
            "legend": {"0": "low", "1": "medium", "2": "high"},
            "probabilities": {"0": 0.3011, "1": 0.5008, "2": 0.1981},
        },
    },
    "usage": {
        "input_tokens": 996,
        "output_tokens": 0,
        "state_tokens": 105,
        "state_tokens_dropped": 0,
        "truncated": False,
        "truncated_questions": [],
    },
}


class FakeAgent:
    def __init__(self, output: dict):
        self.output = output
        self.calls: list[tuple[str, dict]] = []

    def predict(self, state: str, questions: dict) -> dict:
        self.calls.append((state, questions))
        return copy.deepcopy(self.output)


def mixed_questions():
    questions = dict(ACTION.questions)
    questions.update(DOOR.questions)
    return questions


def test_mock_answers_every_question_in_laya_format():
    questions = mixed_questions()
    result = MockBackend().decide(ACTION.state, questions)

    assert isinstance(result, BackendResult)
    assert result.usage is None
    assert set(result.answers) == set(questions)

    action = result.answers["action"]
    assert isinstance(action, ChoiceAnswer)
    assert action.choice == "attack_A1"
    assert action.probabilities == pytest.approx(
        {"attack_A1": 0.6, "attack_B5": 0.1, "attack_C2": 0.1, "refill": 0.1, "wait": 0.1}
    )
    entropy = -sum(p * math.log(p) for p in action.probabilities.values())
    assert action.confidence == pytest.approx(1 - entropy / math.log(5))
    assert action.answer_confidence == pytest.approx(0.6)

    agent = result.answers["agent_B5"]
    assert isinstance(agent, ChoiceAnswer)
    assert agent.choice == "water"
    assert agent.probabilities == pytest.approx({"water": 0.6, "foam": 0.4})

    door = result.answers["door_safe"]
    assert isinstance(door, NoulAnswer)
    assert door.noul == pytest.approx(0.8)
    assert door.confidence == pytest.approx(0.8) and door.answer_confidence == pytest.approx(0.8)


def test_mock_single_option_and_score():
    questions = {
        "only": ChoiceQuestion(type="choice", instructions="Pick.", criteria={"wait": "Hold."}),
        "spread": ScoreQuestion(type="score", instructions="Rate.", criteria=["lo", "mid", "hi"]),
    }
    result = MockBackend().decide("t=0.0s", questions)

    only = result.answers["only"]
    assert isinstance(only, ChoiceAnswer)
    assert only.probabilities == {"wait": 1.0} and only.confidence == pytest.approx(1.0)

    spread = result.answers["spread"]
    assert isinstance(spread, ScoreAnswer)
    assert spread.probabilities == pytest.approx({"0": 1 / 3, "1": 1 / 3, "2": 1 / 3})
    assert spread.score == pytest.approx(1.0)
    assert spread.confidence == pytest.approx(0.0, abs=1e-9)


def test_mock_is_deterministic():
    questions = mixed_questions()
    first = MockBackend().decide(ACTION.state, questions)
    second = MockBackend().decide(ACTION.state, questions)
    assert first == second


def test_backends_satisfy_the_protocol():
    mock: DecisionBackend = MockBackend()
    laya: DecisionBackend = LayaBackend(agent=FakeAgent(RECORDED))
    assert (mock.name, mock.model) == ("mock", None)
    assert (laya.name, laya.model) == ("laya", "aac6fef/laya-mlx")


def test_laya_maps_a_fake_agent_answer():
    fake = FakeAgent(RECORDED)
    questions = mixed_questions()
    result = LayaBackend(agent=fake).decide(ACTION.state, questions)

    state, sent = fake.calls[0]
    assert state == ACTION.state
    assert sent["action"] == ACTION.questions["action"].model_dump()
    door_text = DOOR.questions["door_safe"].instructions
    assert sent["door_safe"] == {"type": "noul", "instructions": door_text}

    action = result.answers["action"]
    assert isinstance(action, ChoiceAnswer)
    assert action.choice == "attack_A1"
    assert action.probabilities["wait"] == pytest.approx(0.265)
    assert action.answer_confidence == pytest.approx(0.3172)
    assert result.answers["door_safe"] == NoulAnswer(
        type="noul", noul=0.1948, confidence=0.8052, answer_confidence=0.8052
    )
    assert result.usage is not None
    assert result.usage.state_tokens == 105
    assert result.usage.state_tokens_dropped == 0
    assert result.usage.truncated_questions == []


def test_laya_maps_score_answers_without_legend():
    levels = ["low", "medium", "high"]
    questions = {"spread": ScoreQuestion(type="score", instructions="Rate.", criteria=levels)}
    result = LayaBackend(agent=FakeAgent(RECORDED)).decide("t=0.0s", questions)
    spread = result.answers["spread"]
    assert isinstance(spread, ScoreAnswer)
    assert spread.score == pytest.approx(0.897)
    assert set(spread.probabilities) == {"0", "1", "2"}


def test_laya_warns_on_dropped_state_tokens(caplog):
    output = copy.deepcopy(RECORDED)
    output["usage"]["state_tokens_dropped"] = 12
    with caplog.at_level(logging.WARNING, logger="firescout_brain"):
        result = LayaBackend(agent=FakeAgent(output)).decide(ACTION.state, dict(ACTION.questions))
    assert result.usage is not None and result.usage.state_tokens_dropped == 12
    assert result.answers["action"].type == "choice"
    assert any("12" in r.getMessage() for r in caplog.records)


def test_laya_warns_on_collapsed_options(caplog):
    output = copy.deepcopy(RECORDED)
    output["usage"]["options"] = {"action": {"kept": 3}}
    with caplog.at_level(logging.WARNING, logger="firescout_brain"):
        LayaBackend(agent=FakeAgent(output)).decide(ACTION.state, dict(ACTION.questions))
    assert any("options" in r.getMessage() for r in caplog.records)


def test_laya_answers_only_the_asked_questions():
    result = LayaBackend(agent=FakeAgent(RECORDED)).decide(ACTION.state, dict(DOOR.questions))
    assert set(result.answers) == {"door_safe"}


@pytest.mark.model
def test_laya_real_checkpoint_answers_the_action_fixture():
    result = LayaBackend().decide(ACTION.state, dict(ACTION.questions))
    assert set(result.answers) == set(ACTION.questions)
    assert result.usage is not None
    assert result.usage.state_tokens_dropped == 0
    assert result.usage.truncated_questions == []
