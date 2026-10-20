import {
  type Answers,
  BaselinePolicy,
  choiceAnswer,
  createRng,
  type DecisionRequest,
  Engine,
  noulAnswer,
  type Policy,
  runGame,
  serializeState,
  uniformScoreAnswer,
} from "@firescout/sim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecideRequest } from "./protocol";
import { RemotePolicy, type WebSocketLike } from "./remote";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.drop();
  }

  open(backend = "mock"): void {
    this.readyState = 1;
    this.onopen?.();
    this.push({ type: "hello", protocol: 1, backend, model: null });
  }

  push(message: unknown): void {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }

  drop(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  get requests(): DecideRequest[] {
    return this.sent.map((s) => JSON.parse(s) as DecideRequest);
  }
}

/** A `connect` that records every socket it opens. */
function fakeConnect() {
  const sockets: FakeSocket[] = [];
  const connect = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  };
  return { sockets, connect };
}

/** Answers like the brain's MockBackend: first option 0.6, noul 0.8, score uniform. */
function mockAnswers(questions: DecisionRequest["questions"]): Answers {
  const answers: Answers = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "noul") answers[id] = noulAnswer(0.8);
    else if (q.type === "score") answers[id] = uniformScoreAnswer(q.criteria);
    else {
      const labels = Object.keys(q.criteria);
      const rest = labels.length > 1 ? 0.4 / (labels.length - 1) : 0;
      answers[id] = choiceAnswer(
        Object.fromEntries(
          labels.map((l, i) => [l, labels.length === 1 ? 1 : i === 0 ? 0.6 : rest]),
        ),
      );
    }
  }
  return answers;
}

function decision(id: number, answers: Answers, backend = "mock") {
  return { type: "decision", id, backend, escalated: false, latency_ms: 12, answers, usage: null };
}

/** The start request of a seed-1 game (attack options, agent questions, refill, wait). */
function startRequest(): DecisionRequest {
  const r = new Engine({ seed: 1 }).step();
  if (r.kind !== "pending") throw new Error("expected a start request");
  return r.request;
}

function waitAnswers(req: DecisionRequest): Answers {
  const answers = mockAnswers(req.questions);
  const labels = Object.keys(
    req.questions.action?.type === "choice" ? req.questions.action.criteria : {},
  );
  answers.action = choiceAnswer(Object.fromEntries(labels.map((l) => [l, l === "wait" ? 1 : 0])));
  return answers;
}

describe("RemotePolicy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function openPolicy(fallback: Policy | null = new BaselinePolicy()) {
    const { sockets, connect } = fakeConnect();
    const policy = new RemotePolicy({ url: "ws://test/ws", fallback, connect });
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.open();
    return { policy, socket, sockets };
  }

  it("sends the serialized state and resolves with the matching answers", async () => {
    const { policy, socket } = openPolicy();
    expect(policy.status).toBe("open");
    expect(policy.backend).toBe("mock");

    const req = startRequest();
    const pending = policy.decide(req);
    const [sent] = socket.requests;
    expect(sent).toEqual({
      type: "decide",
      id: 1,
      unit: "R1",
      state: serializeState(req.context),
      questions: req.questions,
    });

    const answers = waitAnswers(req);
    socket.push(decision(1, answers, "laya"));
    expect(await pending).toEqual(answers);
    expect(policy.lastMeta).toEqual({ source: "brain", backend: "laya", latencyMs: 12 });
  });

  it("uses its own wire ids, never the engine's", async () => {
    const { policy, socket } = openPolicy();
    const req = startRequest();
    for (let n = 1; n <= 2; n++) {
      const pending = policy.decide(req);
      socket.push(decision(n, waitAnswers(req)));
      await pending;
    }
    expect(socket.requests.map((r) => r.id)).toEqual([1, 2]);
    expect(req.id).toBe(1);
  });

  it("ignores a reply for another id", async () => {
    const { policy, socket } = openPolicy();
    const req = startRequest();
    let settled = false;
    const pending = policy.decide(req).then((a) => {
      settled = true;
      return a;
    });
    socket.push(decision(99, waitAnswers(req)));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    socket.push(decision(1, waitAnswers(req)));
    expect((await pending).action).toEqual(waitAnswers(req).action);
  });

  it("ignores a late reply after a timeout, so it never resolves a newer request", async () => {
    const { policy, socket } = openPolicy();
    const req = startRequest();
    const first = policy.decide(req);
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(policy.lastMeta?.reason).toBe("timeout");

    let settled = false;
    const second = policy.decide(req).then((a) => {
      settled = true;
      return a;
    });
    socket.push(decision(1, waitAnswers(req)));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    socket.push(decision(2, waitAnswers(req)));
    await second;
    expect(policy.lastMeta?.source).toBe("brain");
  });

  it("falls back at once when the brain is offline", async () => {
    const { sockets, connect } = fakeConnect();
    const baseline = new BaselinePolicy();
    const policy = new RemotePolicy({ url: "ws://test/ws", fallback: baseline, connect });
    sockets[0]?.drop();
    expect(policy.status).toBe("closed");

    const req = startRequest();
    expect(await policy.decide(req)).toEqual(await baseline.decide(req));
    expect(policy.lastMeta).toMatchObject({
      source: "fallback",
      backend: "baseline",
      reason: "offline",
    });
    expect(sockets[0]?.sent).toEqual([]);
  });

  it("falls back for the pending decision when the socket drops", async () => {
    const { policy, socket } = openPolicy();
    const pending = policy.decide(startRequest());
    socket.drop();
    await pending;
    expect(policy.lastMeta).toMatchObject({ source: "fallback", reason: "disconnected" });
  });

  it("falls back on timeout, on an error reply and on a malformed reply", async () => {
    const { policy, socket } = openPolicy();
    const req = startRequest();

    const timedOut = policy.decide(req);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(policy.lastMeta).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(policy.lastMeta).toMatchObject({ source: "fallback", reason: "timeout" });

    const errored = policy.decide(req);
    socket.push({ type: "error", id: 2, message: "backend error: boom" });
    await errored;
    expect(policy.lastMeta).toMatchObject({ source: "fallback" });
    expect(policy.lastMeta?.reason).toContain("boom");

    const malformed = policy.decide(req);
    socket.push({ ...decision(3, waitAnswers(req)), latency_ms: "fast" });
    await malformed;
    expect(policy.lastMeta).toMatchObject({ source: "fallback", reason: "malformed reply" });

    const notJson = policy.decide(req);
    socket.push("{not json");
    await vi.advanceTimersByTimeAsync(10_000);
    await notJson;
    expect(policy.lastMeta).toMatchObject({ source: "fallback", reason: "timeout" });
  });

  it("falls back when an answer is missing or a label is unknown", async () => {
    const { policy, socket } = openPolicy();
    const req = startRequest();

    const missing = policy.decide(req);
    const partial = waitAnswers(req);
    delete partial.action;
    socket.push(decision(1, partial));
    await missing;
    expect(policy.lastMeta).toMatchObject({ source: "fallback" });
    expect(policy.lastMeta?.reason).toContain("action");

    const unknown = policy.decide(req);
    const bad = waitAnswers(req);
    bad.action = choiceAnswer({ attack_Z9: 1 });
    socket.push(decision(2, bad));
    await unknown;
    expect(policy.lastMeta?.reason).toContain("attack_Z9");

    const wrongType = policy.decide(req);
    const typed = waitAnswers(req);
    typed.action = noulAnswer(0.9);
    socket.push(decision(3, typed));
    await wrongType;
    expect(policy.lastMeta?.reason).toContain("action");
  });

  it("rejects instead of falling back when fallback is null", async () => {
    const { policy, socket } = openPolicy(null);
    const req = startRequest();
    const errored = policy.decide(req);
    socket.push({ type: "error", id: 1, message: "boom" });
    await expect(errored).rejects.toThrow(/boom/);

    socket.drop();
    await expect(policy.decide(req)).rejects.toThrow(/offline/);
  });

  it("reconnects after reconnectMs and uses the brain again", async () => {
    const { policy, socket, sockets } = openPolicy();
    socket.drop();
    expect(policy.status).toBe("closed");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    expect(policy.status).toBe("connecting");

    sockets[1]?.open("laya");
    expect(policy.status).toBe("open");
    expect(policy.backend).toBe("laya");
    const req = startRequest();
    const pending = policy.decide(req);
    sockets[1]?.push(decision(1, waitAnswers(req), "laya"));
    await pending;
    expect(policy.lastMeta?.source).toBe("brain");
  });

  it("treats an error before open as a failed connection and retries", async () => {
    // Node 22's WebSocket fires only `error` (no `close`) when the connection is refused.
    const { sockets, connect } = fakeConnect();
    const policy = new RemotePolicy({
      url: "ws://test/ws",
      fallback: new BaselinePolicy(),
      connect,
    });
    sockets[0]?.onerror?.();
    expect(policy.status).toBe("closed");
    expect(sockets[0]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    expect(policy.status).toBe("open");
  });

  it("keeps retrying while the brain stays down, and stops after close()", async () => {
    const { sockets, connect } = fakeConnect();
    const policy = new RemotePolicy({ url: "ws://test/ws", fallback: null, connect });
    sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    sockets[1]?.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(3);

    policy.close();
    expect(sockets[2]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(3);
    expect(policy.status).toBe("closed");
  });

  it("treats a connect that throws as offline and retries", async () => {
    let calls = 0;
    const socket = new FakeSocket();
    const policy = new RemotePolicy({
      url: "bad url",
      fallback: new BaselinePolicy(),
      connect: () => {
        calls++;
        if (calls === 1) throw new Error("invalid url");
        return socket;
      },
    });
    expect(policy.status).toBe("closed");
    await policy.decide(startRequest());
    expect(policy.lastMeta?.reason).toBe("offline");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toBe(2);
  });
});

describe("RemotePolicy determinism", () => {
  /** A brain that answers like MockBackend after a random 0–20 ms delay. */
  function slowBrain(seed: number) {
    const rng = createRng(seed);
    return (_url: string) => {
      const s = new FakeSocket();
      s.send = (data: string) => {
        const req = JSON.parse(data) as DecideRequest;
        setTimeout(() => s.push(decision(req.id, mockAnswers(req.questions))), rng.next() * 20);
      };
      setTimeout(() => s.open(), 0);
      return s;
    };
  }

  async function play(seed: number): Promise<{ hash: string; answers: Answers[] }> {
    const remote = new RemotePolicy({
      url: "ws://test/ws",
      fallback: null,
      connect: slowBrain(seed),
    });
    await vi.waitFor(() => expect(remote.status).toBe("open"));
    const answers: Answers[] = [];
    const recording: Policy = {
      name: "brain",
      decide: async (req) => {
        const a = await remote.decide(req);
        answers.push(a);
        return a;
      },
    };
    const result = await runGame({ seed: 3, maxTime: 20 }, recording);
    remote.close();
    return { hash: result.hash, answers };
  }

  it("keeps the game independent of latency", async () => {
    const a = await play(1);
    const b = await play(2);
    expect(a.answers.length).toBeGreaterThan(5);
    expect(b.hash).toBe(a.hash);

    const queue = [...a.answers];
    const replay: Policy = {
      name: "replay",
      decide: async () => {
        const next = queue.shift();
        if (!next) throw new Error("replay ran out of answers");
        return next;
      },
    };
    expect((await runGame({ seed: 3, maxTime: 20 }, replay)).hash).toBe(a.hash);
  });
});
