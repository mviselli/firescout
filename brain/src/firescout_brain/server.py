"""FastAPI app: `/health` and one WebSocket `/ws` that answers `decide` requests."""

import asyncio
import json
import logging
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from firescout_brain.backends import DecisionBackend
from firescout_brain.log import DecisionLog
from firescout_brain.protocol import (
    CLIENT_MESSAGE,
    DecideRequest,
    DecisionResponse,
    ErrorResponse,
    Hello,
)

logger = logging.getLogger("firescout_brain")


def create_app(backend: DecisionBackend, log: DecisionLog | None = None) -> FastAPI:
    app = FastAPI(title="firescout-brain")
    # MLX is not thread-safe: one inference at a time across every socket.
    lock = asyncio.Lock()

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "backend": backend.name, "model": backend.model}

    async def decide(request: DecideRequest) -> DecisionResponse | ErrorResponse:
        try:
            async with lock:
                start = time.perf_counter()
                result = await asyncio.to_thread(backend.decide, request.state, request.questions)
                latency_ms = (time.perf_counter() - start) * 1000
        except Exception as e:
            logger.exception("backend failed on request %d", request.id)
            return _error(request.id, f"backend error: {e}")

        missing = sorted(set(request.questions) - set(result.answers))
        extra = sorted(set(result.answers) - set(request.questions))
        if missing or extra:
            return _error(request.id, f"backend answers mismatch: missing {missing}, extra {extra}")
        response = DecisionResponse(
            type="decision",
            id=request.id,
            backend=backend.name,
            escalated=False,
            latency_ms=latency_ms,
            answers=result.answers,
            usage=result.usage,
        )
        if log is not None:
            # A broken log must never cost the client its answer or its socket.
            try:
                log.write(request, response)
            except OSError:
                logger.exception("could not log decision %d", request.id)
        return response

    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        await socket.accept()
        hello = Hello(type="hello", protocol=1, backend=backend.name, model=backend.model)
        await _send(socket, hello)
        try:
            while True:
                text = await socket.receive_text()
                try:
                    raw = json.loads(text)
                except json.JSONDecodeError as e:
                    await _send(socket, _error(None, f"invalid JSON: {e}"))
                    continue
                try:
                    request = CLIENT_MESSAGE.validate_python(raw)
                except ValidationError as e:
                    await _send(socket, _error(_readable_id(raw), _describe(e)))
                    continue
                await _send(socket, await decide(request))
        except WebSocketDisconnect:
            pass

    return app


async def _send(socket: WebSocket, message: DecisionResponse | ErrorResponse | Hello) -> None:
    await socket.send_text(message.model_dump_json(exclude_unset=True))


def _error(request_id: int | None, message: str) -> ErrorResponse:
    return ErrorResponse(type="error", id=request_id, message=message)


def _readable_id(raw: object) -> int | None:
    if not isinstance(raw, dict):
        return None
    value = raw.get("id")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 1:
        return value
    return None


def _describe(e: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(p) for p in err['loc']) or 'message'}: {err['msg']}" for err in e.errors()
    )
