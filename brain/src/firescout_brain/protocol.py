"""The browser/bench <-> brain wire protocol.

Mirrors `brain-client/src/protocol.ts`; both are pinned by `shared/fixtures/protocol/`.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator

MAX_OPTIONS = 10

Unit = Annotated[float, Field(ge=0, le=1)]
Id = Annotated[int, Field(ge=1)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ChoiceQuestion(_Model):
    type: Literal["choice"]
    instructions: str
    criteria: Annotated[dict[str, str], Field(min_length=1, max_length=MAX_OPTIONS)]


class NoulQuestion(_Model):
    type: Literal["noul"]
    instructions: str


class ScoreQuestion(_Model):
    type: Literal["score"]
    instructions: str
    criteria: Annotated[list[str], Field(min_length=2, max_length=MAX_OPTIONS)]


Question = Annotated[ChoiceQuestion | NoulQuestion | ScoreQuestion, Field(discriminator="type")]


class DecideRequest(_Model):
    type: Literal["decide"]
    id: Id
    unit: Literal["R1"]
    state: Annotated[str, Field(min_length=1, max_length=4000)]
    questions: Annotated[dict[str, Question], Field(min_length=1)]


class _Answer(_Model):
    confidence: Unit
    # Optional means absent, never null, as in zod's `.optional()`.
    answer_confidence: Unit | None = None

    @field_validator("answer_confidence", mode="before")
    @classmethod
    def _not_null(cls, v: object) -> object:
        if v is None:
            raise ValueError("answer_confidence is omitted, not null")
        return v


class ChoiceAnswer(_Answer):
    type: Literal["choice"]
    choice: str
    probabilities: dict[str, Unit]


class NoulAnswer(_Answer):
    type: Literal["noul"]
    noul: Unit


class ScoreAnswer(_Answer):
    type: Literal["score"]
    score: Annotated[float, Field(ge=0)]
    probabilities: dict[str, Unit]


Answer = Annotated[ChoiceAnswer | NoulAnswer | ScoreAnswer, Field(discriminator="type")]


class Usage(_Model):
    state_tokens: Annotated[int, Field(ge=0)]
    state_tokens_dropped: Annotated[int, Field(ge=0)]
    truncated_questions: list[str]


class DecisionResponse(_Model):
    type: Literal["decision"]
    id: Id
    backend: str
    escalated: bool
    latency_ms: Annotated[float, Field(ge=0)]
    answers: dict[str, Answer]
    usage: Usage | None


class ErrorResponse(_Model):
    type: Literal["error"]
    id: Id | None
    message: str


class Hello(_Model):
    type: Literal["hello"]
    protocol: Literal[1]
    backend: str
    model: str | None


ClientMessage = Annotated[DecideRequest, Field(discriminator="type")]
ServerMessage = Annotated[DecisionResponse | ErrorResponse | Hello, Field(discriminator="type")]

CLIENT_MESSAGE: TypeAdapter[DecideRequest] = TypeAdapter(ClientMessage)
SERVER_MESSAGE: TypeAdapter[DecisionResponse | ErrorResponse | Hello] = TypeAdapter(ServerMessage)
