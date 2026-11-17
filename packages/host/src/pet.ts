// The desktop pet (ADR 0070): a tee in front of the chat channel. Everything AgentHerd sends to
// the owner still goes to Feishu; the pet sees the same views, shows the latest one in its bubble
// with the buttons of whatever waits for the owner, and passes what the owner types or presses
// there back in as the owner's own message or button press. It never writes text of its own and
// makes no model calls; its short idle lines live in the app.

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
 * What the pet knows: the latest line and the open cards. One feed lives as long as the host;
 * each herd start wraps its new channel with it.
 */
export interface PetFeedOptions {
  /** Something the pet shows changed. */
  changed: () => void;
  /**
   * The chat line that tells what the owner typed to the pet, so the chat still reads as one
   * conversation. Undefined: nothing is posted.
   */
  echo?: (text: string) => string;
  now?: () => Date;
}

export class PetFeed {
  private seq = 0;
  private lastLine: (PetLine & { ref?: string }) | undefined;
  /** Open cards by message ref, oldest first. */
  private readonly open = new Map<string, PetPending>();
  private sink: InboundSink | undefined;
  private ownerId: string | undefined;
  private inner: Channel | undefined;
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
      // Straight to the chat, past the pet: the owner just typed it and needs no bubble for it.
      await this.inner.send({ kind: "text", text: this.opts.echo(t) }).catch(() => undefined);
    }
    await sink({ kind: "message", text: t, from: ownerId });
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
    this.feed.detach(this.inner);
    await this.inner.stop();
  }

  async send(view: View): Promise<MessageRef> {
    const ref = await this.inner.send(view);
    this.feed.sent(ref, view);
    return ref;
  }

  async update(ref: MessageRef, view: View): Promise<void> {
    await this.inner.update(ref, view);
    this.feed.updated(ref, view);
  }

  pin(ref: MessageRef): Promise<void> {
    return this.inner.pin(ref);
  }
}
