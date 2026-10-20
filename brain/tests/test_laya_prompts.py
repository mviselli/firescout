"""Sim-generated scenarios (shared/fixtures/scenarios) against the real Laya checkpoint.

They pin what the game actually sends: every question fits the 512-token budget, and Laya
answers the clear-cut cases as expected. Run with: uv run pytest -m model tests/test_laya_prompts.py
"""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "scenarios"
SCENARIOS = sorted(ROOT.glob("*.json"))

pytestmark = pytest.mark.model


@pytest.fixture(scope="module")
def agent():
    from laya_mlx import load

    return load("aac6fef/laya-mlx")


@pytest.fixture(params=SCENARIOS, ids=lambda p: p.stem)
def scenario(request):
    return json.loads(request.param.read_text())


def test_scenarios_exist():
    assert len(SCENARIOS) >= 6


def test_fits_the_token_budget(agent, scenario):
    usage = agent.predict(scenario["state"], scenario["questions"])["usage"]
    assert usage["state_tokens_dropped"] == 0
    assert usage["truncated_questions"] == []
    assert "options" not in usage


def test_answers_as_expected(agent, scenario):
    if not scenario["expect"]:
        pytest.skip("no expectation (token budget only)")
    answers = agent.predict(scenario["state"], scenario["questions"])["answers"]
    for qid, expected in scenario["expect"].items():
        answer = answers[qid]
        if answer["type"] == "noul":
            p = answer["noul"]
            assert (p > 0.5) == (expected == "true"), f"{qid}: P(true)={p:.3f}, expected {expected}"
        else:
            probs = answer["probabilities"]
            assert answer["choice"] == expected, f"{qid}: {probs}, expected {expected}"
