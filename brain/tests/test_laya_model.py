"""Checks against the real Laya checkpoint. Run with: uv run pytest -m model"""

import pytest


@pytest.fixture(scope="module")
def agent():
    from laya_mlx import load

    return load("aac6fef/laya-mlx")


@pytest.mark.model
def test_choice_answer_has_probabilities_over_all_options(agent):
    out = agent.predict(
        "Fire in B5 is burning paint and solvents.",
        {
            "agent": {
                "type": "choice",
                "instructions": "Which extinguishing agent should be used on B5?",
                "criteria": {
                    "water": "For solid fuels like paper and wood.",
                    "foam": "For flammable liquids like paint and solvents.",
                },
            }
        },
    )
    answer = out["answers"]["agent"]
    assert set(answer["probabilities"]) == {"water", "foam"}
    assert answer["choice"] == "foam"
    assert sum(answer["probabilities"].values()) == pytest.approx(1.0, abs=1e-3)
