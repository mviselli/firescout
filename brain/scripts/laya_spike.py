"""Phase 0 spike: load Laya-MLX, ask FireScout-style questions, report format and latency.

Usage: uv run python scripts/laya_spike.py [model_id]
"""

import json
import sys
import time

from laya_mlx import load

MODEL = sys.argv[1] if len(sys.argv) > 1 else "aac6fef/laya-mlx"

STATE = """t=18.4s unit=R1 pos=E3 water=62% foam=88%
known_fires:
  B5 building=paint int=0.81 near_fuel=high dist=9
  B2 building=paper int=0.40 near_fuel=med dist=19
door B-west: smoke=0.71 heat=high
wind: W->E 18 km/h
drone S1: battery=41% mode=front"""

QUESTIONS = {
    "action": {
        "type": "choice",
        "instructions": "Next action for firefighting robot R1?",
        "criteria": {
            "attack_B5": "Attack the paint store fire in B5. Intense, close, spreading.",
            "attack_B2": "Attack the paper store fire in B2. Weaker, far away.",
            "refill": "Return to base to refill water and foam.",
            "wait": "Hold position.",
        },
    },
    "agent": {
        "type": "choice",
        "instructions": (
            "Which extinguishing agent should R1 use on the fire in B5 "
            "(burning paint and solvents)?"
        ),
        "criteria": {
            "water": "Water jet. For solid fuels like paper and wood.",
            "foam": "Foam. For flammable liquids like paint and solvents.",
            "powder": "Dry powder.",
        },
    },
    "door_safe": {
        "type": "noul",
        "instructions": "Opening door B-west now is safe.",
    },
    "spread": {
        "type": "score",
        "instructions": "How fast is the fire spreading in sector B5?",
        "criteria": ["low", "medium", "high"],
    },
}

if __name__ == "__main__":
    t0 = time.perf_counter()
    agent = load(MODEL)
    print(
        f"load: {time.perf_counter() - t0:.1f}s  max_len={agent.cfg.get('max_len')} "
        f"head_max_len={agent.cfg.get('head_max_len')}"
    )

    state_tokens = len(agent.tok(STATE, add_special_tokens=False)["input_ids"])
    print(f"state tokens: {state_tokens}")

    agent.predict(STATE, QUESTIONS)  # warm-up
    runs = []
    for _ in range(10):
        t = time.perf_counter()
        out = agent.predict(STATE, QUESTIONS)
        runs.append((time.perf_counter() - t) * 1000)
    runs.sort()
    print(f"latency (4 questions): median={runs[5]:.0f}ms min={runs[0]:.0f}ms max={runs[-1]:.0f}ms")
    print(json.dumps(out, indent=2))
