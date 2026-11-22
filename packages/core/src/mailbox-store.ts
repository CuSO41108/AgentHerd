// The Herder's mailbox in herd.db (ADR 0099): the sources the owner set up, what each remembers
// between two looks, and the letters they brought with what the Herder made of each.

import type { DatabaseSync } from "node:sqlite";

/** Kinds of source AgentHerd knows how to check. */
export const MAILBOX_KINDS = ["github", "rss", "hn", "script", "timer"] as const;
export type MailboxKind = (typeof MAILBOX_KINDS)[number];

/** What the Herder made of a letter: tell the owner now, keep for the daily digest, or only note it. */
export const LETTER_FATES = ["now", "digest", "noted"] as const;
export type LetterFate = (typeof LETTER_FATES)[number];

/** Ids a source remembers having seen; older ones are forgotten. */
export const SEEN_KEEP = 1000;
/** Letters kept; older ones are deleted. */
export const LETTERS_KEEP = 2000;

/** One thing a source brought. `id` is the source's own, unique within the source. */
export interface Letter {
  id: string;
  title: string;
  body?: string;
  link?: string;
}

export interface MailboxSource {
  id: string;
  kind: MailboxKind;
  /** A short name the owner sees. */
  name: string;
  /** One sentence for the Herder: what the owner cares about here. */
  note: string;
  /** Kind-specific settings (repository, address, words, command…). */
  config: Record<string, unknown>;
  everyMinutes: number;
  paused: boolean;
  by: "owner" | "herder";
  createdAt: string;
  /** The first look is done: what it found then was only remembered, not delivered. */
  started: boolean;
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string;
  /** Looks that failed in a row. */
  fails: number;
  /** Letters it brought. */
  letters: number;
}

export interface StoredLetter {
  id: number;
  sourceId: string;
  letterId: string;
  /** When it came. */
  at: string;
  title: string;
  body: string;
  link?: string;
  /** When it went to the Herder. */
  sentAt?: string;
  fate?: LetterFate;
  why?: string;
  filedAt?: string;
  digestedAt?: string;
}

type Row = Record<string, unknown>;

const opt = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

function toSource(r: Row): MailboxSource {
  return {
    id: String(r.id),
    kind: String(r.kind) as MailboxKind,
    name: String(r.name),
    note: String(r.note),
    config: JSON.parse(String(r.config_json)) as Record<string, unknown>,
    everyMinutes: Number(r.every_minutes),
    paused: Number(r.paused) === 1,
    by: String(r.made_by) === "herder" ? "herder" : "owner",
    createdAt: String(r.created_at),
    started: Number(r.started) === 1,
    ...(opt(r.last_run_at) === undefined ? {} : { lastRunAt: String(r.last_run_at) }),
    ...(opt(r.last_ok_at) === undefined ? {} : { lastOkAt: String(r.last_ok_at) }),
    ...(opt(r.last_error) === undefined ? {} : { lastError: String(r.last_error) }),
    fails: Number(r.fails),
    letters: Number(r.letters ?? 0),
  };
}

function toLetter(r: Row): StoredLetter {
  const fate = opt(r.fate);
  return {
    id: Number(r.id),
    sourceId: String(r.source_id),
    letterId: String(r.letter_id),
    at: String(r.at),
    title: String(r.title),
    body: String(r.body),
    ...(opt(r.link) === undefined ? {} : { link: String(r.link) }),
    ...(opt(r.sent_at) === undefined ? {} : { sentAt: String(r.sent_at) }),
    ...(fate === undefined ? {} : { fate: fate as LetterFate }),
    ...(opt(r.why) === undefined ? {} : { why: String(r.why) }),
    ...(opt(r.filed_at) === undefined ? {} : { filedAt: String(r.filed_at) }),
    ...(opt(r.digested_at) === undefined ? {} : { digestedAt: String(r.digested_at) }),
  };
}

const SOURCE_SELECT = `SELECT s.*, (SELECT COUNT(*) FROM mailbox_letters l WHERE l.source_id = s.id) AS letters
FROM mailbox_sources s`;

export class MailboxStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  sources(): MailboxSource[] {
    return (this.db.prepare(`${SOURCE_SELECT} ORDER BY s.created_at`).all() as Row[]).map(toSource);
  }

  source(id: string): MailboxSource | undefined {
    const r = this.db.prepare(`${SOURCE_SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
    return r === undefined ? undefined : toSource(r);
  }

  addSource(s: MailboxSource): void {
    this.db
      .prepare(
        `INSERT INTO mailbox_sources(id, kind, name, note, config_json, every_minutes, paused, made_by,
          created_at, started, fails) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        s.id,
        s.kind,
        s.name,
        s.note,
        JSON.stringify(s.config),
        s.everyMinutes,
        s.paused ? 1 : 0,
        s.by,
        s.createdAt,
        s.started ? 1 : 0,
      );
  }

  /** Saves what the owner may change. A changed `config` starts the source over (a new first look). */
  updateSource(s: MailboxSource, restart: boolean): void {
    this.db
      .prepare(
        `UPDATE mailbox_sources SET name = ?, note = ?, config_json = ?, every_minutes = ?, paused = ?
         ${restart ? ", started = 0, state_json = NULL, seen_json = '[]', fails = 0, last_error = NULL" : ""}
         WHERE id = ?`,
      )
      .run(s.name, s.note, JSON.stringify(s.config), s.everyMinutes, s.paused ? 1 : 0, s.id);
  }

  removeSource(id: string): boolean {
    this.db.prepare("DELETE FROM mailbox_letters WHERE source_id = ?").run(id);
    return Number(this.db.prepare("DELETE FROM mailbox_sources WHERE id = ?").run(id).changes) > 0;
  }

  /** What the source keeps between two looks, and the ids it has seen. */
  memory(id: string): { state: unknown; seen: string[] } {
    const r = this.db
      .prepare("SELECT state_json, seen_json FROM mailbox_sources WHERE id = ?")
      .get(id) as Row | undefined;
    if (r === undefined) return { state: undefined, seen: [] };
    return {
      state: r.state_json === null ? undefined : JSON.parse(String(r.state_json)),
      seen: JSON.parse(String(r.seen_json)) as string[],
    };
  }

  /** A look that worked: what it keeps now, the ids seen, and that the first look is done. */
  ranOk(id: string, at: string, state: unknown, seen: string[]): void {
    this.db
      .prepare(
        `UPDATE mailbox_sources SET last_run_at = ?, last_ok_at = ?, last_error = NULL, fails = 0,
          started = 1, state_json = ?, seen_json = ? WHERE id = ?`,
      )
      .run(
        at,
        at,
        state === undefined ? null : JSON.stringify(state),
        JSON.stringify(seen.slice(0, SEEN_KEEP)),
        id,
      );
  }

  /** A look that failed; returns how many failed in a row. */
  ranBadly(id: string, at: string, error: string): number {
    this.db
      .prepare(
        "UPDATE mailbox_sources SET last_run_at = ?, last_error = ?, fails = fails + 1 WHERE id = ?",
      )
      .run(at, error, id);
    const r = this.db.prepare("SELECT fails FROM mailbox_sources WHERE id = ?").get(id) as
      | Row
      | undefined;
    return Number(r?.fails ?? 0);
  }

  /** Keeps new letters; ones the source already brought are skipped. Returns those kept. */
  addLetters(sourceId: string, letters: readonly Letter[], at: string): StoredLetter[] {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO mailbox_letters(source_id, letter_id, at, title, body, link)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const kept: StoredLetter[] = [];
    for (const l of letters) {
      const r = insert.run(sourceId, l.id, at, l.title, l.body ?? "", l.link ?? null);
      if (Number(r.changes) === 0) continue;
      kept.push({
        id: Number(r.lastInsertRowid),
        sourceId,
        letterId: l.id,
        at,
        title: l.title,
        body: l.body ?? "",
        ...(l.link === undefined ? {} : { link: l.link }),
      });
    }
    this.prune();
    return kept;
  }

  /** Letters not yet given to the Herder, oldest first. */
  unsent(limit: number): StoredLetter[] {
    return (
      this.db
        .prepare("SELECT * FROM mailbox_letters WHERE sent_at IS NULL ORDER BY id LIMIT ?")
        .all(limit) as Row[]
    ).map(toLetter);
  }

  markSent(ids: readonly number[], at: string): void {
    const update = this.db.prepare("UPDATE mailbox_letters SET sent_at = ? WHERE id = ?");
    for (const id of ids) update.run(at, id);
  }

  /** Records what the Herder made of a letter; false when there is no such letter. */
  file(id: number, fate: LetterFate, why: string, at: string): boolean {
    const r = this.db
      .prepare("UPDATE mailbox_letters SET fate = ?, why = ?, filed_at = ? WHERE id = ?")
      .run(fate, why, at, id);
    return Number(r.changes) > 0;
  }

  letter(id: number): StoredLetter | undefined {
    const r = this.db.prepare("SELECT * FROM mailbox_letters WHERE id = ?").get(id) as
      | Row
      | undefined;
    return r === undefined ? undefined : toLetter(r);
  }

  /** Letters kept for the digest and not yet in one, oldest first. */
  forDigest(limit: number): StoredLetter[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM mailbox_letters WHERE fate = 'digest' AND digested_at IS NULL ORDER BY id LIMIT ?",
        )
        .all(limit) as Row[]
    ).map(toLetter);
  }

  markDigested(ids: readonly number[], at: string): void {
    const update = this.db.prepare("UPDATE mailbox_letters SET digested_at = ? WHERE id = ?");
    for (const id of ids) update.run(at, id);
  }

  /** Newest first. */
  letters(limit: number, sourceId?: string): StoredLetter[] {
    const rows =
      sourceId === undefined
        ? this.db.prepare("SELECT * FROM mailbox_letters ORDER BY id DESC LIMIT ?").all(limit)
        : this.db
            .prepare("SELECT * FROM mailbox_letters WHERE source_id = ? ORDER BY id DESC LIMIT ?")
            .all(sourceId, limit);
    return (rows as Row[]).map(toLetter);
  }

  private prune(): void {
    this.db
      .prepare(
        `DELETE FROM mailbox_letters WHERE id <= (SELECT id FROM mailbox_letters ORDER BY id DESC
          LIMIT 1 OFFSET ?)`,
      )
      .run(LETTERS_KEEP);
  }
}
