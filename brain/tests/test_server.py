import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from firescout_brain.backends import BackendResult, MockBackend
from firescout_brain.log import DecisionLog
from firescout_brain.protocol import SERVER_MESSAGE, DecisionResponse, ErrorResponse, Hello
from firescout_brain.server import create_app

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "protocol" / "valid"
ACTION = json.loads((FIXTURES / "decide-action.json").read_text())
DOOR = json.loads((FIXTURES / "decide-door.json").read_text())


def receive(ws):
    return SERVER_MESSAGE.validate_python(ws.receive_json())


@pytest.fixture
def client():
    with TestClient(create_app(MockBackend())) as c:
        yield c


def test_health(client):
    assert client.get("/health").json() == {"status": "ok", "backend": "mock", "model": None}


def test_hello_then_decision(client):
    with client.websocket_connect("/ws") as ws:
        assert receive(ws) == Hello(type="hello", protocol=1, backend="mock", model=None)
        ws.send_text(json.dumps(ACTION))
        reply = receive(ws)
        assert isinstance(reply, DecisionResponse)
        assert reply.id == ACTION["id"]
        assert reply.backend == "mock" and reply.escalated is False
        assert reply.latency_ms >= 0
        assert set(reply.answers) == set(ACTION["questions"])
        assert reply.usage is None


def test_invalid_json_keeps_socket_open(client):
    with client.websocket_connect("/ws") as ws:
        receive(ws)
        ws.send_text("nope")
        error = receive(ws)
        assert isinstance(error, ErrorResponse) and error.id is None
        ws.send_text(json.dumps(DOOR))
        reply = receive(ws)
        assert isinstance(reply, DecisionResponse) and reply.id == DOOR["id"]


def test_schema_error_reports_the_id(client):
    bad = {k: v for k, v in ACTION.items() if k != "questions"} | {"id": 7}
    with client.websocket_connect("/ws") as ws:
        receive(ws)
        ws.send_text(json.dumps(bad))
        error = receive(ws)
        assert isinstance(error, ErrorResponse)
        assert error.id == 7
        assert "questions" in error.message


def test_unreadable_id_is_null(client):
    with client.websocket_connect("/ws") as ws:
        receive(ws)
        ws.send_text(json.dumps([1, 2]))
        error = receive(ws)
        assert isinstance(error, ErrorResponse) and error.id is None and error.message


def test_two_pipelined_requests_get_their_own_answers(client):
    with client.websocket_connect("/ws") as ws:
        receive(ws)
        ws.send_text(json.dumps(ACTION | {"id": 1}))
        ws.send_text(json.dumps(DOOR | {"id": 2}))
        first, second = receive(ws), receive(ws)
        assert isinstance(first, DecisionResponse) and isinstance(second, DecisionResponse)
        assert (first.id, second.id) == (1, 2)
        assert set(first.answers) == set(ACTION["questions"])
        assert set(second.answers) == {"door_safe"}


class RaisingBackend:
    name = "broken"
    model = None

    def decide(self, state, questions):
        raise RuntimeError("model crashed")


def test_backend_exception_becomes_error():
    with TestClient(create_app(RaisingBackend())) as c, c.websocket_connect("/ws") as ws:
        receive(ws)
        ws.send_text(json.dumps(ACTION))
        error = receive(ws)
        assert isinstance(error, ErrorResponse)
        assert error.id == ACTION["id"] and "model crashed" in error.message


class PartialBackend:
    """Answers only the first question."""

    name = "partial"
    model = None

    def decide(self, state, questions):
        full = MockBackend().decide(state, questions)
        first = next(iter(full.answers))
        return BackendResult(answers={first: full.answers[first]}, usage=None)


def test_incomplete_answers_become_an_error():
    with TestClient(create_app(PartialBackend())) as c, c.websocket_connect("/ws") as ws:
        receive(ws)
        ws.send_text(json.dumps(ACTION))
        error = receive(ws)
        assert isinstance(error, ErrorResponse) and error.id == ACTION["id"]
        assert "agent_B5" in error.message


def test_every_decision_is_logged(tmp_path):
    path = tmp_path / "nested" / "decisions.jsonl"
    with (
        TestClient(create_app(MockBackend(), DecisionLog(path))) as c,
        c.websocket_connect("/ws") as ws,
    ):
        receive(ws)
        for request in (ACTION, DOOR):
            ws.send_text(json.dumps(request))
            receive(ws)
        ws.send_text("nope")
        receive(ws)

    lines = [json.loads(line) for line in path.read_text().splitlines()]
    assert len(lines) == 2
    assert [line["id"] for line in lines] == [ACTION["id"], DOOR["id"]]
    first = lines[0]
    assert set(first) == {
        "ts",
        "id",
        "unit",
        "backend",
        "latency_ms",
        "state",
        "questions",
        "answers",
        "usage",
    }
    assert datetime.fromisoformat(first["ts"]).tzinfo is not None
    assert first["unit"] == "R1" and first["backend"] == "mock"
    assert first["state"] == ACTION["state"]
    assert first["questions"] == ACTION["questions"]
    assert set(first["answers"]) == set(ACTION["questions"])
    assert first["usage"] is None


def test_cli_defaults_and_overrides():
    from firescout_brain import parse_args

    args = parse_args([])
    assert (args.backend, args.model, args.host, args.port) == (
        "laya",
        "aac6fef/laya-mlx",
        "127.0.0.1",
        8765,
    )
    assert args.log == Path("logs/decisions.jsonl")
    args = parse_args(["--backend", "mock", "--port", "9000", "--log", "x.jsonl"])
    assert (args.backend, args.port, args.log) == ("mock", 9000, Path("x.jsonl"))


class BrokenLog(DecisionLog):
    def __init__(self):
        super().__init__(Path("/nonexistent"))

    def write(self, request, response):
        raise OSError("disk full")


def test_a_failing_log_still_answers_and_keeps_the_socket_open():
    with TestClient(create_app(MockBackend(), BrokenLog())) as c, c.websocket_connect("/ws") as ws:
        receive(ws)
        for request in (ACTION, DOOR):
            ws.send_text(json.dumps(request))
            reply = receive(ws)
            assert isinstance(reply, DecisionResponse) and reply.id == request["id"]
