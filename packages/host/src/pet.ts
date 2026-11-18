// The desktop pet (ADR 0070): a tee in front of the chat channel. Everything AgentHerd sends to
// the owner still goes to Feishu; the pet sees the same views, shows the latest one in its bubble
// with the buttons of whatever waits for the owner, and passes what the owner types or presses
// there back in as the owner's own message or button press; what the owner typed is quoted on top
// of the Herder's next chat answer rather than sent alone, so the chat app does not ring for it.
// The expanded pet shows the Herder's
// conversation kept in herd.db (`historyOf`), so it reaches back past restarts. It never writes
// text of its own and makes no model calls; its short idle lines live in the app.

import type { HerderTurn } from "@agentherd/core";
import type {
  Channel,
  ChannelBinding,
  ChannelCapability,
  InboundSink,
  MessageRef,
  SetupUI,
  View,
} from "@agentherd/protocol";
import type { PetLine, PetPending } from "./api.ts";

/** Longest text the pet keeps for one line or one card body. */
export const PET_TEXT_MAX = 600;
/** Lines of the conversation the expanded pet shows; older ones are in the chat app. */
export const PET_HISTORY_MAX = 80;
/** Longest text of one line in the conversation. */
export const PET_HISTORY_TEXT_MAX = 1500;
/**
 * How long what the owner typed in the pet waits to ride on the Herder's answer before it goes
 * to the chat alone (ADR 0070). A message of its own makes the chat app ring for words the owner
 * wrote.
 */
export const PET_ECHO_HOLD_MS = 2 * 60_000;
/** Chat messages whose echo is kept, so an update in place does not drop it. */
const ECHOED_MAX = 50;

/**
 * The Herder answering: its own words or its question. Not a task's message, an offer with
 * buttons, the board, a report or a card.
 */
function carriesEcho(view: View): boolean {
  if (view.kind === "ask") return true;
  return view.kind === "text" && view.taskLabel === undefined && view.target === undefined;
}

/** The view with what the owner typed in the pet quoted on top. */
function withEcho(view: View, echo: string): View {
  if (view.kind !== "text" && view.kind !== "ask") return view;
  return { ...view, text: `${echo}\n\n${view.text}` };
}

function cut(text: string, max = PET_TEXT_MAX): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function key(ref: MessageRef): string {
  return `${ref.channelId}:${ref.id}`;
}

/** What waits for the owner on this card, or undefined when nothing does (closed, or no buttons). */
function pendingOf(view: View): PetPending | undefined {
  if (view.kind === "item") {
    if (view.final !== undefined || view.options.length === 0) return undefined;
    const pending: PetPending = {
      target: view.itemId,
      title: cut(view.title, 200),
      body: cut(
        view.lines === undefined
          ? view.body
          : view.lines
              .filter((l) => l.final === undefined)
              .map((l) => `${l.n}. ${l.title}`)
              .join("\n"),
        400,
      ),
      options: view.options,
    };
    if (view.taskLabel !== undefined) pending.task = view.taskLabel;
    if (view.lines !== undefined)
      pending.count = view.lines.filter((l) => l.final === undefined).length;
    return pending;
  }
  if (view.kind === "ask") {
    if (view.final !== undefined || view.options.length === 0) return undefined;
    return { target: view.askId, title: cut(view.text, 400), body: "", options: view.options };
  }
  if (view.kind === "text" && view.target !== undefined && (view.options?.length ?? 0) > 0) {
    const pending: PetPending = {
      target: view.target,
      title: cut(view.title ?? view.text, 400),
      body: view.title === undefined ? "" : cut(view.text, 400),
      options: view.options ?? [],
    };
    if (view.taskLabel !== undefined) pending.task = view.taskLabel;
    return pending;
  }
  return undefined;
}

/** The line the pet says for a new message; undefined for the board and relay cards. */
function lineOf(view: View): Omit<PetLine, "id" | "at"> | undefined {
  switch (view.kind) {
    case "text": {
      const text = cut(view.title === undefined ? view.text : `${view.title}：${view.text}`);
      if (view.tone === "error") return { kind: "error", text, ...task(view.taskLabel) };
      if (view.taskLabel !== undefined || view.tone !== undefined) {
        return { kind: "task", text, ...task(view.taskLabel) };
      }
      return { kind: "say", text };
    }
    case "report":
      return { kind: "report", text: cut(view.body), task: view.title, result: view.result };
    case "item":
      return { kind: "ask", text: cut(view.title, 200), ...task(view.taskLabel) };
    case "ask":
      return { kind: "ask", text: cut(view.text, 400) };
    default:
      return undefined;
  }
}

function task(label: string | undefined): { task?: string } {
  return label === undefined ? {} : { task: label };
}

/**
 * The conversation for the expanded pet, from the lines the Herder keeps in herd.db
 * (`herder_turns`): the owner's messages and answers, the Herder's replies and questions, and
 * the reports it passed on. Oldest first.
 */
export function historyOf(
  turns: readonly HerderTurn[],
  titleOf: (taskId: string) => string | undefined,
): PetLine[] {
  const lines: PetLine[] = [];
  for (const turn of turns) {
    const text = cut(turn.text, PET_HISTORY_TEXT_MAX);
    if (text === "") continue;
    const base = { id: turn.id, at: turn.at, text };
    if (turn.role === "owner" || turn.role === "answer") {
      lines.push({ ...base, kind: "owner" });
    } else if (turn.role === "ask") {
      lines.push({ ...base, kind: "ask" });
    } else if (turn.role === "event") {
      // Already says which task: "title: what happened".
      lines.push({ ...base, kind: "task" });
    } else {
      const title = turn.taskId === undefined ? undefined : titleOf(turn.taskId);
      lines.push({ ...base, kind: "say", ...task(title) });
    }
  }
  return lines;
}

type Entry = PetLine & { ref?: string };

/**
 * What the pet knows: the latest line and the open cards. One feed lives as long as the host;
 * each herd start wraps its new channel with it.
 */
export interface PetFeedOptions {
  /** Something the pet shows changed. */
  changed: () => void;
  /**
   * The chat line that tells what the owner typed to the pet, so the chat still reads as one
   * conversation. It is quoted on top of the Herder's next answer, or posted alone after
   * `echoHoldMs`. Undefined: nothing is posted.
   */
  echo?: (text: string) => string;
  /** Default `PET_ECHO_HOLD_MS`. */
  echoHoldMs?: number;
  now?: () => Date;
}

/** Echo lines that wait for the Herder's answer on one channel. */
interface HeldEcho {
  channel: Channel;
  lines: string[];
  timer: ReturnType<typeof setTimeout>;
}

export class PetFeed {
  private seq = 0;
  private lastLine: Entry | undefined;
  /** Open cards by message ref, oldest first. */
  private readonly open = new Map<string, PetPending>();
  private sink: InboundSink | undefined;
  private ownerId: string | undefined;
  private inner: Channel | undefined;
  private held: HeldEcho | undefined;
  /** The echo quoted on a chat message, by message ref. */
  private readonly echoed = new Map<string, string>();
  private readonly opts: PetFeedOptions;

  constructor(opts: PetFeedOptions) {
    this.opts = opts;
  }

  /** The channel the herd uses: the same as `inner`, and the pet sees what it sends. */
  wrap(inner: Channel): Channel {
    this.inner = inner;
    return new PetChannel(inner, this);
  }

  private changed(): void {
    this.opts.changed();
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  get connected(): boolean {
    return this.sink !== undefined;
  }

  get last(): PetLine | undefined {
    if (this.lastLine === undefined) return undefined;
    const { ref: _ref, ...line } = this.lastLine;
    return line;
  }

  /** Open cards, oldest first. */
  pending(): PetPending[] {
    return [...this.open.values()];
  }

  /** The owner typed this in the pet's bubble: it reaches AgentHerd like a chat message. */
  async say(text: string): Promise<void> {
    const t = text.trim();
    if (t === "") throw new Error("说点什么再发送");
    const { sink, ownerId } = this.inbound();
    if (this.opts.echo !== undefined && this.inner !== undefined) {
      // Not a message of its own: the owner wrote it, so the chat app should not ring for it.
      this.hold(this.inner, [this.opts.echo(t)]);
    }
    await sink({ kind: "message", text: t, from: ownerId });
  }

  private hold(channel: Channel, lines: string[], first = false): void {
    const held = this.held;
    if (held !== undefined && held.channel === channel) {
      if (first) held.lines.unshift(...lines);
      else held.lines.push(...lines);
      return;
    }
    if (held !== undefined) void this.flush(held.channel);
    const timer = setTimeout(
      () => void this.flush(channel),
      this.opts.echoHoldMs ?? PET_ECHO_HOLD_MS,
    );
    timer.unref?.();
    this.held = { channel, lines: [...lines], timer };
  }

  /** @internal The Herder took too long, or the channel stops: the echo goes to the chat alone. */
  async flush(channel: Channel): Promise<void> {
    const held = this.held;
    if (held === undefined || held.channel !== channel) return;
    this.held = undefined;
    clearTimeout(held.timer);
    // Straight to the chat, past the pet: the owner just typed it and needs no bubble for it.
    await channel.send({ kind: "text", text: held.lines.join("\n") }).catch(() => undefined);
  }

  /** @internal The echo to quote on this view, taken off the hold; undefined if none. */
  takeEcho(channel: Channel, view: View): string[] | undefined {
    const held = this.held;
    if (held === undefined || held.channel !== channel || !carriesEcho(view)) return undefined;
    this.held = undefined;
    clearTimeout(held.timer);
    return held.lines;
  }

  /** @internal The view could not be sent: its echo waits again. */
  returnEcho(channel: Channel, lines: string[]): void {
    this.hold(channel, lines, true);
  }

  /** @internal This chat message carries the echo; updates keep it. */
  rememberEcho(ref: MessageRef, echo: string): void {
    this.echoed.set(key(ref), echo);
    if (this.echoed.size > ECHOED_MAX) {
      const oldest = this.echoed.keys().next().value;
      if (oldest !== undefined) this.echoed.delete(oldest);
    }
  }

  /** @internal */
  echoOf(ref: MessageRef): string | undefined {
    return this.echoed.get(key(ref));
  }

  /** The owner pressed a button in the bubble: the same as pressing it on the Feishu card. */
  async press(target: string, action: string): Promise<void> {
    const open = [...this.open.values()].find((p) => p.target === target);
    if (open === undefined || !open.options.some((o) => o.action === action)) {
      throw new Error("这件事已经处理过了");
    }
    const { sink, ownerId } = this.inbound();
    await sink({ kind: "action", target, action, from: ownerId });
  }

  private inbound(): { sink: InboundSink; ownerId: string } {
    if (this.sink === undefined || this.ownerId === undefined) {
      throw new Error("AgentHerd 还没连上飞书，先在 App 里设置好");
    }
    return { sink: this.sink, ownerId: this.ownerId };
  }

  /** @internal */
  attach(binding: ChannelBinding, sink: InboundSink): void {
    this.sink = sink;
    this.ownerId = binding.ownerId;
    this.changed();
  }

  /** @internal The herd stopped: its cards can no longer be answered. */
  detach(inner: Channel): void {
    if (inner !== this.inner) return;
    this.sink = undefined;
    this.ownerId = undefined;
    this.open.clear();
    this.changed();
  }

  /** @internal */
  sent(ref: MessageRef, view: View): void {
    const k = key(ref);
    const pending = pendingOf(view);
    if (pending !== undefined) this.open.set(k, pending);
    const line = lineOf(view);
    if (line !== undefined) {
      this.seq++;
      this.lastLine = { ...line, id: this.seq, at: this.now().toISOString(), ref: k };
    }
    if (pending !== undefined || line !== undefined) this.changed();
  }

  /** @internal An update in place: a card closed or changed, or a message was edited. */
  updated(ref: MessageRef, view: View): void {
    const k = key(ref);
    let changed = false;
    const pending = pendingOf(view);
    if (pending !== undefined) {
      this.open.set(k, pending);
      changed = true;
    } else if (this.open.delete(k)) {
      changed = true;
    }
    // An edited message (a progress line that grows): the same line, new words.
    if (this.lastLine?.ref === k && view.kind === "text") {
      const line = lineOf(view);
      if (line !== undefined) {
        this.lastLine = { ...this.lastLine, ...line };
        changed = true;
      }
    }
    if (changed) this.changed();
  }
}

class PetChannel implements Channel {
  readonly id: string;
  readonly capabilities: ChannelCapability[];
  private readonly inner: Channel;
  private readonly feed: PetFeed;

  constructor(inner: Channel, feed: PetFeed) {
    this.inner = inner;
    this.feed = feed;
    this.id = inner.id;
    this.capabilities = inner.capabilities;
  }

  setup(ui: SetupUI): Promise<ChannelBinding> {
    return this.inner.setup(ui);
  }

  async start(binding: ChannelBinding, sink: InboundSink): Promise<void> {
    await this.inner.start(binding, sink);
    this.feed.attach(binding, sink);
  }

  async stop(): Promise<void> {
    await this.feed.flush(this.inner);
    this.feed.detach(this.inner);
    await this.inner.stop();
  }

  async send(view: View): Promise<MessageRef> {
    const lines = this.feed.takeEcho(this.inner, view);
    if (lines === undefined) {
      const ref = await this.inner.send(view);
      this.feed.sent(ref, view);
      return ref;
    }
    const echo = lines.join("\n");
    let ref: MessageRef;
    try {
      ref = await this.inner.send(withEcho(view, echo));
    } catch (error) {
      this.feed.returnEcho(this.inner, lines);
      throw error;
    }
    this.feed.rememberEcho(ref, echo);
    // The pet shows the Herder's words alone: the owner's line is already in its conversation.
    this.feed.sent(ref, view);
    return ref;
  }

  async update(ref: MessageRef, view: View): Promise<void> {
    const echo = this.feed.echoOf(ref);
    await this.inner.update(ref, echo === undefined ? view : withEcho(view, echo));
    this.feed.updated(ref, view);
  }

  pin(ref: MessageRef): Promise<void> {
    return this.inner.pin(ref);
  }
}
