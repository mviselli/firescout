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

## Phase 2 prompt check (`brain/tests/test_laya_prompts.py`)

Scenarios are generated from the real sim (`bench/src/fixtures.test.ts` → `shared/fixtures/scenarios/`). Every
question of every scenario fits: 0 state tokens dropped, no truncated questions, no collapsed options.

| scenario | expected | Laya | state tokens |
|---|---|---|---|
| `paint-fire` | `attack_B5`, foam | `attack_B5` 0.53, foam 0.69 | 64 |
| `paper-fire` | water | water 0.72 (`attack_B3` 0.70) | 68 |
| `smoky-door` (smoke 0.90) | unsafe | P(true) 0.21 | 86 |
| `clear-door` (no smoke) | safe | P(true) 0.66 | 86 |
| `empty-tanks` | (budget only) | `attack_B5` 0.62 | 64 |
| `worst-case` (26 sectors, door ahead, 7% tanks) | (budget only) | `attack_C1` 0.67; foam ~0.55 on all three solid fires | 125 |

Findings from ~30 wording variants:
- **Laya never picks `refill`**: 0.01–0.08 under every option text, state line and label, even when the only other
  option is `wait` (0.96). So the controller refills: an attack whose agent tank is empty becomes a refill, and a
  tank that runs dry mid-attack sends R1 back to base, for every policy.
- `wait` reads as attractive: "Hold position." beat a 6-cell paint fire (0.52 vs 0.42); "Stand still." flips it
  (0.53). Adding analysis to `wait`/`refill` ("tanks are full", "fires keep burning") made `wait` win more often.
- The agent question works on a single fire with the spike's short criteria (foam 0.69 on paint, water 0.72 on
  paper), but with three fires in the state it is close to a coin flip in either direction (foam 0.36 on paint in
  `decide-action.json`, foam ~0.55 on solids in `worst-case`). This is left to the benchmark's wrong-agent metric.
- Laya does not weigh distances: in `worst-case` it picks the fire 9 cells away behind a door over one 1 cell away.
