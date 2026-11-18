// The desktop pet (ADR 0070): a tee in front of the chat channel. Everything AgentHerd sends to
// the owner still goes to Feishu; the pet sees the same views, shows the latest one in its bubble
// with the buttons of whatever waits for the owner, and passes what the owner types or presses
// there back in as the owner's own message or button press. The expanded pet shows the Herder's
// conversation kept in herd.db (`historyOf`), so it reaches back past restarts, with the cards
// sent to the owner (reports, approvals, questions) kept in herd.db too (ADR 0072). It never
// writes text of its own and makes no model calls.

import type { HerderTurn, OwnerCard } from "@agentherd/core";
import { withoutContextMarks } from "@agentherd/herder";
import type {
  Channel,
  ChannelBinding,
  ChannelCapability,
  InboundSink,
  MessageRef,
  SetupUI,
  View,
} from "@agentherd/protocol";
import { hasHerdUi, herdUiChoices } from "@agentherd/protocol/herd-ui";
import type { PetCard, PetCardView, PetLine, PetPending } from "./api.ts";

/** Longest text the pet keeps for one line or one card body. */
export const PET_TEXT_MAX = 600;
/** Lines of the conversation the expanded pet shows; older ones are in the chat app. */
export const PET_HISTORY_MAX = 80;
/** Longest text of one line in the conversation. */
export const PET_HISTORY_TEXT_MAX = 1500;
/** Cards the expanded pet shows, the newest. */
export const PET_CARDS_MAX = 60;
/** Longest report or agent reply a card in the pet keeps; the app has the whole task. */
export const PET_CARD_TEXT_MAX = 4000;
/** Longest text with a herd-ui block the pet keeps: cutting the block would lose it (ADR 0074). */
export const PET_UI_TEXT_MAX = 12_000;

/** How long a text may be in the pet: longer when it carries a herd-ui block. */
function maxFor(text: string, max: number): number {
  return hasHerdUi(text) ? Math.max(max, PET_UI_TEXT_MAX) : max;
}

function cut(text: string, max = PET_TEXT_MAX): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function key(ref: MessageRef): string {
  return `${ref.channelId}:${ref.id}`;
}

/**
 * The views the pet shows as cards: reports, approvals, questions, offers with buttons, and
 * Herder replies whose herd-ui offers choices (ADR 0074).
 */
export function isCardView(view: View): view is PetCardView {
  return (
    view.kind === "report" ||
    view.kind === "item" ||
    view.kind === "ask" ||
    (view.kind === "text" &&
      view.target !== undefined &&
      ((view.options?.length ?? 0) > 0 || herdUiChoices(view.text).length > 0))
  );
}

/** Every button on a card that still works, as the target and action it sends. */
function buttonsOf(view: View): { target: string; action: string }[] {
  if (view.kind === "item") {
    if (view.final !== undefined) return [];
    const own = view.options.map((o) => ({ target: view.itemId, action: o.action }));
    const lines = (view.lines ?? [])
      .filter((l) => l.final === undefined)
      .flatMap((l) => l.options.map((o) => ({ target: l.itemId, action: o.action })));
    return [...own, ...lines];
  }
  if (view.kind === "ask") {
    return view.final === undefined
      ? view.options.map((o) => ({ target: view.askId, action: o.action }))
      : [];
  }
  if (view.kind === "text" && view.target !== undefined) {
    const target = view.target;
    if ((view.options?.length ?? 0) > 0) {
      return (view.options ?? []).map((o) => ({ target, action: o.action }));
    }
    // A reply's choices work until one is picked.
    if (view.chosen !== undefined) return [];
    return herdUiChoices(view.text).map((a) => ({ target, action: a.action }));
  }
  return [];
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
      const words = view.title === undefined ? view.text : `${view.title}：${view.text}`;
      const text = cut(words, maxFor(words, PET_TEXT_MAX));
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
    // Older replies may still begin with a ref tag the model wrote itself (ADR 0045).
    const said = turn.role === "herder" || turn.role === "ask";
    const words = said ? withoutContextMarks(turn.text) : turn.text;
    const text = cut(words, maxFor(words, PET_HISTORY_TEXT_MAX));
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

function plain(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A line of herd.db that a card already shows: the question of an ask card, the Herder's words
 * of a report it spoke, the note a report or an answered approval left for the Herder, a reply
 * whose choices make it a card (ADR 0074).
 */
function shownAsCard(turn: HerderTurn, views: readonly PetCardView[]): boolean {
  const text = plain(turn.text);
  const said = turn.role === "herder" ? plain(withoutContextMarks(turn.text)) : "";
  for (const view of views) {
    if (view.kind === "text" && said !== "" && said === plain(view.text)) return true;
    if (view.kind === "ask" && turn.role === "ask" && text.startsWith(plain(view.text))) {
      return true;
    }
    if (view.kind === "report" && turn.taskId === view.taskId) {
      if (turn.role === "herder" && text === plain(view.body)) return true;
      if (turn.role === "event" && text === plain(`${view.title}: ${view.body}`)) return true;
    }
    if (view.kind === "item" && turn.role === "event") {
      const titles = [view.title, ...(view.lines ?? []).map((l) => l.title)];
      if (titles.some((t) => text.endsWith(`: ${plain(t)}`))) return true;
    }
  }
  return false;
}

/** A card as the pet gets it: long texts cut, the app has the rest. */
function forPet(view: PetCardView): PetCardView {
  if (view.kind === "report") {
    return {
      ...view,
      body: cut(view.body, PET_CARD_TEXT_MAX),
      ...(view.fullReply === undefined
        ? {}
        : { fullReply: cut(view.fullReply, PET_CARD_TEXT_MAX) }),
    };
  }
  if (view.kind === "item") {
    return {
      ...view,
      body: cut(view.body, 2000),
      ...(view.lines === undefined
        ? {}
        : { lines: view.lines.map((l) => ({ ...l, body: cut(l.body, 600) })) }),
    };
  }
  if (view.kind === "text") return { ...view, text: cut(view.text, maxFor(view.text, 2000)) };
  return view;
}

/**
 * The expanded pet's conversation (ADR 0072): the lines of herd.db and the cards sent to the
 * owner since the first of those lines, without the lines a card already shows. `isOpen` says
 * which cards can still be answered in this run.
 */
export function petConversation(
  turns: readonly HerderTurn[],
  stored: readonly OwnerCard[],
  titleOf: (taskId: string) => string | undefined,
  isOpen: (ref: string) => boolean,
): { history: PetLine[]; cards: PetCard[] } {
  // A full window of lines starts somewhere in the past: older cards would stand alone.
  const from = turns.length >= PET_HISTORY_MAX ? (turns[0]?.at ?? "") : "";
  const kept = stored.filter(
    (c): c is OwnerCard & { view: PetCardView } => c.at >= from && isCardView(c.view),
  );
  const views = kept.map((c) => c.view);
  return {
    history: historyOf(
      turns.filter((t) => !shownAsCard(t, views)),
      titleOf,
    ),
    cards: kept.map((c) => ({ ref: c.ref, at: c.at, view: forPet(c.view), open: isOpen(c.ref) })),
  };
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
   * conversation. Undefined: nothing is posted.
   */
  echo?: (text: string) => string;
  /** Keeps a card in its latest form, for the conversation after a restart (ADR 0072). */
  keep?: (ref: string, view: PetCardView) => void;
  now?: () => Date;
}

export class PetFeed {
  private seq = 0;
  private lastLine: Entry | undefined;
  /** Cards with buttons that still work, by message ref, oldest first. */
  private readonly open = new Map<string, View>();
  private sink: InboundSink | undefined;
  private ownerId: string | undefined;
  private inner: Channel | undefined;
  private echoing: Promise<void> | undefined;
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
    return [...this.open.values()].flatMap((v) => pendingOf(v) ?? []);
  }

  /** The card sent as `ref` (`channelId:messageId`) can still be answered. */
  isOpen(ref: string): boolean {
    return this.open.has(ref);
  }

  /** Starts posting the echo to Feishu without holding up the Herder; later chat sends wait behind it. */
  private queueEcho(inner: Channel, text: string): void {
    const send = () =>
      inner.send({ kind: "text", text }).then(
        () => undefined,
        () => undefined,
      );
    const next = this.echoing === undefined ? send() : this.echoing.then(send);
    const tracked = next.finally(() => {
      if (this.echoing === tracked) this.echoing = undefined;
    });
    this.echoing = tracked;
  }

  /** @internal Waits for any in-flight pet echo so AgentHerd's reply lands after it in Feishu. */
  waitEcho(): Promise<void> {
    return this.echoing ?? Promise.resolve();
  }

  /** The owner typed this in the pet's bubble: it reaches AgentHerd like a chat message. */
  async say(text: string): Promise<void> {
    const t = text.trim();
    if (t === "") throw new Error("说点什么再发送");
    const { sink, ownerId } = this.inbound();
    if (this.opts.echo !== undefined && this.inner !== undefined) {
      // Straight to the chat, past the pet: start it now so the Herder does not wait on Feishu.
      this.queueEcho(this.inner, this.opts.echo(t));
    }
    await sink({ kind: "message", text: t, from: ownerId });
  }

  /** The owner pressed a button in the bubble: the same as pressing it on the Feishu card. */
  async press(target: string, action: string): Promise<void> {
    const open = [...this.open.values()].some((v) =>
      buttonsOf(v).some((b) => b.target === target && b.action === action),
    );
    if (!open) throw new Error("这件事已经处理过了");
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
    this.echoing = undefined;
    this.open.clear();
    this.changed();
  }

  /** @internal */
  sent(ref: MessageRef, view: View): void {
    const k = key(ref);
    this.keep(k, view);
    const open = buttonsOf(view).length > 0;
    if (open) this.open.set(k, view);
    const line = lineOf(view);
    if (line !== undefined) {
      this.seq++;
      this.lastLine = {
        ...line,
        id: this.seq,
        at: this.now().toISOString(),
        ref: k,
        ...(isCardView(view) ? { card: k } : {}),
      };
    }
    if (open || line !== undefined) this.changed();
  }

  private keep(ref: string, view: View): void {
    if (this.opts.keep === undefined || !isCardView(view)) return;
    try {
      this.opts.keep(ref, view);
    } catch {
      // The pet shows less after a restart; the chat app has the card.
    }
  }

  /** @internal An update in place: a card closed or changed, or a message was edited. */
  updated(ref: MessageRef, view: View): void {
    const k = key(ref);
    this.keep(k, view);
    // A card's new form shows in the conversation even when its buttons did not change.
    let changed = isCardView(view);
    if (buttonsOf(view).length > 0) {
      this.open.set(k, view);
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
    this.feed.detach(this.inner);
    await this.inner.stop();
  }

  async send(view: View): Promise<MessageRef> {
    await this.feed.waitEcho();
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
