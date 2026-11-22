// The Herder's mailbox (ADR 0099). The owner sets up sources: a GitHub repository, a feed, words
// on Hacker News, a script of their own, or a timer. Code looks at each source on its own clock and
// compares with what it saw before; the model is not called for that. Only letters the source has
// not brought before go to the Herder, all that came in one look together, and the Herder decides
// for each: tell the owner now, keep it for the morning digest, or only note it. The first look of
// a source only remembers what is there (nothing old is delivered), and the letters are other
// people's words: the Herder reads them as data, never as the owner's instructions.

import { randomUUID } from "node:crypto";
import type { Timer } from "./clock.ts";
import { type HerdContext, say } from "./herd-context.ts";
import {
  LETTER_FATES,
  type Letter,
  type LetterFate,
  MAILBOX_KINDS,
  type MailboxKind,
  type MailboxSource,
  type StoredLetter,
} from "./mailbox-store.ts";

/** Sources at most. */
export const MAILBOX_SOURCES_MAX = 30;
/** How often AgentHerd looks whether a source is due. */
export const MAILBOX_TICK_MS = 60_000;
/** The shortest time between two looks at a source, per kind (minutes). */
export const MAILBOX_EVERY_MIN: Record<MailboxKind, number> = {
  github: 5,
  rss: 15,
  hn: 15,
  script: 1,
  timer: 5,
};
/** Minutes between two looks unless the owner said otherwise. */
export const MAILBOX_EVERY_DEFAULT: Record<MailboxKind, number> = {
  github: 10,
  rss: 60,
  hn: 60,
  script: 30,
  timer: 24 * 60,
};
/** Letters one look delivers; the rest are only remembered as seen. */
export const LETTERS_PER_LOOK = 20;
/** Letters given to the Herder in one go. */
export const LETTERS_PER_DELIVERY = 30;
/** Letters in one digest. */
export const LETTERS_PER_DIGEST = 60;
export const LETTER_TITLE_MAX = 160;
export const LETTER_BODY_MAX = 1200;
/** What a source keeps between two looks, as JSON. */
export const MAILBOX_STATE_MAX = 64_000;
/** The digest of letters the Herder kept goes out at this local hour. */
export const DIGEST_HOUR = 9;
/** After this many failed looks in a row the owner is told, once. */
export const MAILBOX_FAILS_TOLD = 3;
const NAME_MAX = 40;
const NOTE_MAX = 300;
const DIGEST_STATE_KEY = "mailbox.digest";

export type { Letter, LetterFate, MailboxKind, MailboxSource, StoredLetter };
export { LETTER_FATES, MAILBOX_KINDS };

/** What a look found, and what the source keeps for the next look. */
export interface CheckResult {
  letters: Letter[];
  state?: unknown;
}

/** Looks at one source. `state` is what the last look kept (undefined on the first). */
export type MailboxCheck = (source: MailboxSource, state: unknown) => Promise<CheckResult>;

export interface MailboxSourceInput {
  kind: MailboxKind;
  name: string;
  note?: string;
  config?: Record<string, unknown>;
  everyMinutes?: number;
  by?: "owner" | "herder";
}

export interface MailboxPatch {
  name?: string;
  note?: string;
  config?: Record<string, unknown>;
  everyMinutes?: number;
  paused?: boolean;
}

/** Letters of one source as the Herder gets them. */
export interface LetterGroup {
  sourceId: string;
  name: string;
  kind: MailboxKind;
  note: string;
  letters: { id: number; title: string; body: string; link?: string }[];
}

/** `new`: letters that just came. `digest`: the ones the Herder kept for the morning digest. */
export interface LetterDelivery {
  kind: "new" | "digest";
  groups: LetterGroup[];
}

export interface MailboxOptions {
  check: MailboxCheck;
  /** Called when sources or letters changed, for the app. */
  changed?: () => void;
  tickMs?: number;
  digestHour?: number;
}

function tidy(text: string, max: number): string {
  const t = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** A source's letters made safe to keep: an id, a title on one line, a web link only. */
export function cleanLetters(letters: readonly Letter[]): Letter[] {
  const out: Letter[] = [];
  const ids = new Set<string>();
  for (const l of letters) {
    if (l === null || typeof l !== "object") continue;
    const id = typeof l.id === "string" || typeof l.id === "number" ? String(l.id).trim() : "";
    if (id === "" || id.length > 300 || ids.has(id)) continue;
    const title = tidy(String(l.title ?? "").replace(/\s+/g, " "), LETTER_TITLE_MAX);
    const body = tidy(typeof l.body === "string" ? l.body : "", LETTER_BODY_MAX);
    const link = typeof l.link === "string" && /^https?:\/\/\S+$/.test(l.link) ? l.link : undefined;
    ids.add(id);
    out.push({
      id,
      title: title === "" ? "(no title)" : title,
      ...(body === "" ? {} : { body }),
      ...(link === undefined ? {} : { link }),
    });
  }
  return out;
}

function groupsOf(
  letters: readonly StoredLetter[],
  source: (id: string) => MailboxSource | undefined,
): LetterGroup[] {
  const groups = new Map<string, LetterGroup>();
  for (const l of letters) {
    const s = source(l.sourceId);
    if (s === undefined) continue;
    const g = groups.get(s.id) ?? {
      sourceId: s.id,
      name: s.name,
      kind: s.kind,
      note: s.note,
      letters: [],
    };
    g.letters.push({
      id: l.id,
      title: l.title,
      body: l.body,
      ...(l.link === undefined ? {} : { link: l.link }),
    });
    groups.set(s.id, g);
  }
  return [...groups.values()];
}

export class Mailbox {
  private readonly ctx: HerdContext;
  private readonly opts: MailboxOptions;
  private timer: Timer | undefined;
  private stopped = true;
  private chain: Promise<void> = Promise.resolve();
  private readonly busy = new Set<string>();

  constructor(ctx: HerdContext, opts: MailboxOptions) {
    this.ctx = ctx;
    this.opts = opts;
  }

  private get store() {
    return this.ctx.store.mailbox;
  }

  private now(): string {
    return this.ctx.clock.now().toISOString();
  }

  start(): void {
    this.stopped = false;
    this.schedule(5_000);
  }

  stop(): void {
    this.stopped = true;
    this.timer?.cancel();
    this.timer = undefined;
  }

  private schedule(ms = this.opts.tickMs ?? MAILBOX_TICK_MS): void {
    this.timer?.cancel();
    if (this.stopped) return;
    this.timer = this.ctx.clock.after(ms, () => {
      void this.tick().finally(() => this.schedule());
    });
  }

  list(): MailboxSource[] {
    return this.store.sources();
  }

  letters(limit = 200, sourceId?: string): StoredLetter[] {
    return this.store.letters(limit, sourceId);
  }

  /** The owner (or the Herder, when the owner asked) adds a source. Its first look runs soon. */
  add(input: MailboxSourceInput): MailboxSource {
    if (!(MAILBOX_KINDS as readonly string[]).includes(input.kind)) {
      throw new Error(`kind must be one of ${MAILBOX_KINDS.join(", ")}`);
    }
    if (this.store.sources().length >= MAILBOX_SOURCES_MAX) {
      throw new Error(`at most ${MAILBOX_SOURCES_MAX} sources; remove one first`);
    }
    const source: MailboxSource = {
      id: randomUUID(),
      kind: input.kind,
      name: this.name(input.name),
      note: this.note(input.note ?? ""),
      config: input.config ?? {},
      everyMinutes: this.every(input.kind, input.everyMinutes),
      paused: false,
      by: input.by ?? "owner",
      createdAt: this.now(),
      // A timer has nothing to look at: its first letter comes when it is due.
      started: input.kind === "timer",
      fails: 0,
      letters: 0,
    };
    this.store.addSource(source);
    this.ctx.store.audit("mailbox.add", { id: source.id, kind: source.kind, by: source.by });
    this.opts.changed?.();
    if (input.kind !== "timer") this.runSoon(source.id);
    return this.store.source(source.id) ?? source;
  }

  set(id: string, patch: MailboxPatch): MailboxSource {
    const old = this.one(id);
    const config = patch.config ?? old.config;
    const next: MailboxSource = {
      ...old,
      ...(patch.name === undefined ? {} : { name: this.name(patch.name) }),
      ...(patch.note === undefined ? {} : { note: this.note(patch.note) }),
      config,
      everyMinutes:
        patch.everyMinutes === undefined
          ? old.everyMinutes
          : this.every(old.kind, patch.everyMinutes),
      ...(patch.paused === undefined ? {} : { paused: patch.paused }),
    };
    const restart = JSON.stringify(config) !== JSON.stringify(old.config) && old.kind !== "timer";
    this.store.updateSource(next, restart);
    this.ctx.store.audit("mailbox.change", { id, patch: Object.keys(patch) });
    this.opts.changed?.();
    if (restart && !next.paused) this.runSoon(id);
    return this.one(id);
  }

  remove(id: string): boolean {
    const removed = this.store.removeSource(id);
    if (removed) {
      this.ctx.store.audit("mailbox.remove", { id });
      this.opts.changed?.();
    }
    return removed;
  }

  /**
   * One look without keeping anything: what the source would bring now. For the owner to see a
   * source works before adding it, and for a script the Herder wrote.
   */
  async tryOut(input: MailboxSourceInput): Promise<Letter[]> {
    const source: MailboxSource = {
      id: "try",
      kind: input.kind,
      name: this.name(input.name),
      note: this.note(input.note ?? ""),
      config: input.config ?? {},
      everyMinutes: this.every(input.kind, input.everyMinutes),
      paused: false,
      by: input.by ?? "owner",
      createdAt: this.now(),
      started: false,
      fails: 0,
      letters: 0,
    };
    if (input.kind === "timer") return [this.timerLetter(source)];
    const result = await this.opts.check(source, undefined);
    return cleanLetters(result.letters ?? []).slice(0, LETTERS_PER_LOOK);
  }

  /** Looks at a source now (the owner pressed 「现在看一次」). Resolves with how many letters came. */
  async runNow(id: string): Promise<number> {
    const source = this.one(id);
    let count = 0;
    await this.serial(async () => {
      count = await this.look(source);
      this.deliver();
    });
    return count;
  }

  /** Records what the Herder made of letters; returns the ids that are not letters. */
  file(items: readonly { id: number; fate: LetterFate; why: string }[]): number[] {
    const unknown: number[] = [];
    const at = this.now();
    for (const item of items) {
      if (!(LETTER_FATES as readonly string[]).includes(item.fate)) {
        throw new Error(`fate must be one of ${LETTER_FATES.join(", ")}`);
      }
      if (!this.store.file(item.id, item.fate, tidy(item.why, 200), at)) unknown.push(item.id);
    }
    this.opts.changed?.();
    return unknown;
  }

  /** Every source that is due gets a look, then what came goes to the Herder in one go. */
  tick(): Promise<void> {
    return this.serial(async () => {
      const now = this.ctx.clock.now().getTime();
      for (const source of this.store.sources()) {
        if (source.paused || !this.due(source, now)) continue;
        await this.look(source);
      }
      this.deliver();
      this.digest();
    });
  }

  private serial(run: () => Promise<void>): Promise<void> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  private runSoon(id: string): void {
    if (this.stopped) return;
    void this.serial(async () => {
      const source = this.store.source(id);
      if (source === undefined || source.paused) return;
      await this.look(source);
      this.deliver();
    });
  }

  private due(source: MailboxSource, now: number): boolean {
    const last = source.lastRunAt ?? (source.kind === "timer" ? source.createdAt : undefined);
    if (last === undefined) return true;
    return now - Date.parse(last) >= source.everyMinutes * 60_000;
  }

  private timerLetter(source: MailboxSource): Letter {
    const at = this.ctx.clock.now();
    return { id: at.toISOString().slice(0, 16), title: source.name, body: source.note };
  }

  /** One look at a source; returns how many new letters it kept. */
  private async look(source: MailboxSource): Promise<number> {
    if (this.busy.has(source.id)) return 0;
    this.busy.add(source.id);
    const at = this.now();
    try {
      const memory = this.store.memory(source.id);
      let found: Letter[];
      let state: unknown = memory.state;
      if (source.kind === "timer") {
        found = [this.timerLetter(source)];
      } else {
        const result = await this.opts.check(source, memory.state);
        found = cleanLetters(Array.isArray(result?.letters) ? result.letters : []);
        state = result?.state;
        if (state !== undefined && JSON.stringify(state).length > MAILBOX_STATE_MAX) {
          throw new Error(`what the source keeps is over ${MAILBOX_STATE_MAX} characters`);
        }
      }
      const seen = new Set(memory.seen);
      const fresh = found.filter((l) => !seen.has(l.id));
      const ids = [
        ...found.map((l) => l.id),
        ...memory.seen.filter((id) => !found.some((l) => l.id === id)),
      ];
      // The first look only remembers what is there: nothing old is delivered.
      const kept =
        source.started || source.kind === "timer"
          ? this.store.addLetters(source.id, fresh.slice(0, LETTERS_PER_LOOK), at)
          : [];
      this.store.ranOk(source.id, at, state, ids);
      this.ctx.store.audit("mailbox.look", {
        id: source.id,
        found: found.length,
        new: kept.length,
        ...(source.started ? {} : { first: true }),
      });
      if (kept.length > 0 || !source.started || source.fails > 0) this.opts.changed?.();
      return kept.length;
    } catch (error) {
      const message = tidy((error as Error).message ?? String(error), 300);
      const fails = this.store.ranBadly(source.id, at, message);
      this.ctx.store.audit("mailbox.error", { id: source.id, message, fails });
      if (fails === MAILBOX_FAILS_TOLD) {
        await say(
          this.ctx,
          this.ctx.texts.mailboxDown(source.name, fails, message),
          undefined,
          "error",
        );
      }
      this.opts.changed?.();
      return 0;
    } finally {
      this.busy.delete(source.id);
    }
  }

  /** Letters not yet given to the Herder go to it together. Without a Herder they wait. */
  private deliver(): void {
    const herder = this.ctx.herder();
    if (herder?.letters === undefined) return;
    const letters = this.store.unsent(LETTERS_PER_DELIVERY);
    if (letters.length === 0) return;
    this.store.markSent(
      letters.map((l) => l.id),
      this.now(),
    );
    const groups = groupsOf(letters, (id) => this.store.source(id));
    if (groups.length === 0) return;
    this.ctx.store.audit("mailbox.deliver", { letters: letters.length });
    herder.letters({ kind: "new", groups });
    this.opts.changed?.();
  }

  /** Once a day, at the digest hour, the letters the Herder kept for it go back to it. */
  private digest(): void {
    const herder = this.ctx.herder();
    if (herder?.letters === undefined) return;
    const now = this.ctx.clock.now();
    if (now.getHours() < (this.opts.digestHour ?? DIGEST_HOUR)) return;
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (this.ctx.store.getState<string>(DIGEST_STATE_KEY) === day) return;
    this.ctx.store.setState(DIGEST_STATE_KEY, day);
    const letters = this.store.forDigest(LETTERS_PER_DIGEST);
    if (letters.length === 0) return;
    this.store.markDigested(
      letters.map((l) => l.id),
      this.now(),
    );
    const groups = groupsOf(letters, (id) => this.store.source(id));
    if (groups.length === 0) return;
    this.ctx.store.audit("mailbox.digest", { letters: letters.length });
    herder.letters({ kind: "digest", groups });
  }

  private one(id: string): MailboxSource {
    const found =
      this.store.source(id) ??
      this.store.sources().find((s) => id.length >= 4 && s.id.startsWith(id));
    if (found === undefined) throw new Error(`no source ${id}`);
    return found;
  }

  private name(name: string): string {
    const n = name.replace(/\s+/g, " ").trim();
    if (n === "") throw new Error("a source needs a name");
    return n.slice(0, NAME_MAX);
  }

  private note(note: string): string {
    return tidy(note, NOTE_MAX);
  }

  private every(kind: MailboxKind, minutes: number | undefined): number {
    if (minutes === undefined) return MAILBOX_EVERY_DEFAULT[kind];
    if (!Number.isFinite(minutes) || minutes < MAILBOX_EVERY_MIN[kind]) {
      throw new Error(
        `a ${kind} source is looked at every ${MAILBOX_EVERY_MIN[kind]} minutes at most`,
      );
    }
    return Math.round(minutes);
  }
}
