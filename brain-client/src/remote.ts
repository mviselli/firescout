import {
  type Answers,
  type DecisionRequest,
  type Policy,
  type Answer as SimAnswer,
  serializeState,
} from "@firescout/sim";
import { type DecideRequest, ServerMessageSchema, type Answer as WireAnswer } from "./protocol";

/** The part of the browser/Node `WebSocket` that RemotePolicy uses, so tests can fake it. */
export interface WebSocketLike {
  /** 1 = open. */
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** Where the last decision came from, for the HUD badge. */
export interface DecisionMeta {
  source: "brain" | "fallback";
  backend: string;
  latencyMs: number;
  /** Why the brain was not used. */
  reason?: string;
}

export interface RemotePolicyOptions {
  url: string;
  /** Answers when the brain cannot; null rejects instead (bench e2e). */
  fallback: Policy | null;
  timeoutMs?: number;
  reconnectMs?: number;
  connect?: (url: string) => WebSocketLike;
}

interface Pending {
  req: DecisionRequest;
  started: number;
  timer: ReturnType<typeof setTimeout>;
  settle: (outcome: { answers: Answers; meta: DecisionMeta } | { failure: string }) => void;
}

const OPEN = 1;

/**
 * A Policy answered by the brain over a WebSocket. Every failure (offline, timeout, error reply,
 * malformed or incomplete answers) falls back to `fallback` for that one decision, so the game
 * never hangs; the socket reconnects in the background.
 */
export class RemotePolicy implements Policy {
  readonly name = "brain";
  status: "connecting" | "open" | "closed" = "connecting";
  backend: string | null = null;
  lastMeta: DecisionMeta | null = null;

  private readonly opts: Required<Omit<RemotePolicyOptions, "fallback">> & {
    fallback: Policy | null;
  };
  private socket: WebSocketLike | null = null;
  /** Wire ids come from this counter, never from the engine, whose ids restart every game. */
  private lastId = 0;
  private readonly pending = new Map<number, Pending>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: RemotePolicyOptions) {
    this.opts = {
      timeoutMs: 10_000,
      reconnectMs: 2_000,
      connect: browserSocket,
      ...opts,
    };
    this.connect();
  }

  async decide(req: DecisionRequest): Promise<Answers> {
    const started = Date.now();
    const socket = this.socket;
    if (this.status !== "open" || !socket || socket.readyState !== OPEN) {
      return this.fallBack(req, "offline", started);
    }

    const id = ++this.lastId;
    const message: DecideRequest = {
      type: "decide",
      id,
      unit: req.unit,
      state: serializeState(req.context),
      questions: req.questions,
    };
    const outcome = await new Promise<
      { answers: Answers; meta: DecisionMeta } | { failure: string }
    >((resolve) => {
      const timer = setTimeout(() => this.settle(id, { failure: "timeout" }), this.opts.timeoutMs);
      this.pending.set(id, { req, started, timer, settle: resolve });
      try {
        socket.send(JSON.stringify(message));
      } catch {
        this.settle(id, { failure: "send failed" });
      }
    });
    if ("failure" in outcome) return this.fallBack(req, outcome.failure, started);
    this.lastMeta = outcome.meta;
    return outcome.answers;
  }

  /** Stops reconnecting and closes the socket; pending decisions fall back. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.failAll("closed");
    const socket = this.socket;
    this.socket = null;
    this.status = "closed";
    socket?.close();
  }

  private connect(): void {
    this.status = "connecting";
    let socket: WebSocketLike;
    try {
      socket = this.opts.connect(this.opts.url);
    } catch {
      this.onClosed();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket) this.status = "open";
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.onMessage(ev.data);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.onClosed();
    };
    // Node's WebSocket reports a refused connection with `error` alone, never `close`.
    socket.onerror = () => {
      if (this.socket !== socket || socket.readyState === OPEN) return;
      this.onClosed();
      socket.close();
    };
  }

  private onClosed(): void {
    this.socket = null;
    this.status = "closed";
    this.backend = null;
    this.failAll("disconnected");
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, this.opts.reconnectMs);
  }

  private onMessage(data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      return; // No readable id: the timeout falls back.
    }
    const parsed = ServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const id = readId(raw);
      if (id !== null) this.settle(id, { failure: "malformed reply" });
      return;
    }
    const msg = parsed.data;
    if (msg.type === "hello") {
      this.backend = msg.backend;
      return;
    }
    if (msg.id === null) return;
    const p = this.pending.get(msg.id);
    if (!p) return; // Stale (timed out) or someone else's id.
    if (msg.type === "error") {
      this.settle(msg.id, { failure: `brain error: ${msg.message}` });
      return;
    }
    const mapped = mapAnswers(p.req, msg.answers);
    if (typeof mapped === "string") {
      this.settle(msg.id, { failure: mapped });
      return;
    }
    this.settle(msg.id, {
      answers: mapped,
      meta: { source: "brain", backend: msg.backend, latencyMs: msg.latency_ms },
    });
  }

  private settle(id: number, outcome: Parameters<Pending["settle"]>[0]): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.settle(outcome);
  }

  private failAll(reason: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { failure: reason });
  }

  private async fallBack(req: DecisionRequest, reason: string, started: number): Promise<Answers> {
    const { fallback } = this.opts;
    if (!fallback) throw new Error(`brain unavailable: ${reason}`);
    const answers = await fallback.decide(req);
    this.lastMeta = {
      source: "fallback",
      backend: fallback.name,
      latencyMs: Date.now() - started,
      reason,
    };
    return answers;
  }
}

/** The global WebSocket (browser, Node 22) behind the WebSocketLike handlers. */
function browserSocket(url: string): WebSocketLike {
  const ws = new globalThis.WebSocket(url);
  const like: WebSocketLike = {
    get readyState() {
      return ws.readyState;
    },
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => like.onopen?.();
  ws.onmessage = (ev) => like.onmessage?.({ data: ev.data });
  ws.onclose = () => like.onclose?.();
  ws.onerror = () => like.onerror?.();
  return like;
}

function readId(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null || !("id" in raw)) return null;
  const { id } = raw;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

/** Wire answers → sim answers for exactly the asked questions, or why they don't fit. */
function mapAnswers(req: DecisionRequest, wire: Record<string, WireAnswer>): Answers | string {
  const answers: Answers = {};
  for (const [qid, q] of Object.entries(req.questions)) {
    const a = wire[qid];
    if (!a) return `missing answer for ${qid}`;
    if (a.type !== q.type) return `answer for ${qid} is ${a.type}, expected ${q.type}`;
    if (q.type === "choice" && a.type === "choice" && !Object.hasOwn(q.criteria, a.choice)) {
      return `answer for ${qid}: ${a.choice} is not an option`;
    }
    answers[qid] = toSim(a);
  }
  return answers;
}

function toSim(a: WireAnswer): SimAnswer {
  const extra = a.answer_confidence === undefined ? {} : { answer_confidence: a.answer_confidence };
  switch (a.type) {
    case "choice":
      return {
        type: "choice",
        choice: a.choice,
        probabilities: { ...a.probabilities },
        confidence: a.confidence,
        ...extra,
      };
    case "noul":
      return { type: "noul", noul: a.noul, confidence: a.confidence, ...extra };
    case "score":
      return {
        type: "score",
        score: a.score,
        probabilities: { ...a.probabilities },
        confidence: a.confidence,
        ...extra,
      };
  }
}
