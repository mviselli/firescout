# Laya-MLX: API notes (verified)

Verified on M1 Air 8 GB, `laya-mlx==0.4.0`, checkpoint `aac6fef/laya-mlx`, Python 3.12, MLX 0.32.

## Loading

```python
from laya_mlx import load          # import name is laya_mlx, not laya
agent = load("aac6fef/laya-mlx")  # ~13 s cold; downloads to the HF cache on first run
out = agent.predict(state: str, questions: dict)   # alias of agent.system_one(...)
```

The checkpoint warns that one temperature bucket (`choice` with 11+ options) is clamped, so its confidence is
uncalibrated. Keep choice questions to **10 options or fewer**.

## Questions

| type | `criteria` | answer fields |
|---|---|---|
| `choice` | dict `{label: description}` or list of labels | `choice`, `probabilities{label: p}` |
| `score` | list of levels, low → high | `score` (expected index), `legend`, `probabilities{"0": p, ...}` |
| `noul` | optional `{"true": ..., "false": ...}` | `noul` = P(true) |

Every answer also has:
- `confidence`: normalised distance from a uniform guess (0 = coin flip). For `noul` it equals `max(p, 1 - p)`.
- `answer_confidence`: probability of the chosen option.
- `action.act_probability`

`predict(..., min_confidence=x)` applies a built-in confidence gate. `laya_mlx.Router` also exists and may help with the Phase 5 cascade.

## Token budget

- `max_len=512` **per question**, not per request. Each question is encoded as its own sequence with the state.
  The question and options get up to `head_max_len=192` tokens, and the state is truncated if the rest doesn't fit.
- `usage.state_tokens_dropped` / `usage.truncated` report truncation. **Assert this is 0** in serializer tests.
- The sample FireScout state in `CONTEXT.md` §5 is **105 tokens**.

## Prompting lesson (from the bundled snake policy)

Put the controller's analysis into each option's **description**, for example
`"attack_B5": "Paint fire, intense, close, spreading."`. The model weighs the descriptions, and short planner-derived
descriptions work best.

## Spike results (`brain/scripts/laya_spike.py`)

| question | answer | correct? |
|---|---|---|
| next action | `attack_B5` 0.66 | ✅ |
| extinguishing agent for paint | `foam` 0.61 | ✅ |
| opening smoky door is safe | P(true)=0.14 | ✅ |
| spread rate in B5 (score) | "low" 0.46 | ❌. Score questions need explicit evidence in the state (e.g. growth rate). |

## Latency (M1 Air, warm)

| | 1 question | 4 questions |
|---|---|---|
| eager | ~98 ms | ~335 ms |
| `compile=True, pad_to_multiple=16, cache_prompts=True` | ~90 ms | ~320 ms |

The optimizations are not worth it, so use eager mode. The sim pauses during decisions, so latency only affects the
benchmark's wall time: about 50 seeds × ~200 decisions × ~2 questions × 0.1 s ≈ 1 h per Laya run.
