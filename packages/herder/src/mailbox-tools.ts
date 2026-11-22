// The Herder's mailbox tools (ADR 0099): sources are added, changed and removed only because the
// owner asked; letters are filed only in the turn that brought them.

import {
  type HerderHost,
  LETTER_FATES,
  type LetterFate,
  MAILBOX_KINDS,
  type MailboxKind,
  type MailboxSource,
  type MailboxSourceInput,
} from "@agentherd/core";
import type { AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { arr, bool, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { TurnContext } from "./tools.ts";

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function ownerAsked(turn: () => TurnContext, what: string): void {
  const kind = turn().kind;
  if (kind !== "owner" && kind !== "answer") throw new Error(`only the owner can ${what}`);
}

const KIND_HELP =
  'github: config {repo: "owner/name", what: ["issues","prs","releases"] (default issues and releases), words?: ["crash"]}. rss: {url, words?}. hn: {words: "agent memory", points?: 50}. script: {command, cwd?} — the command reads {"state": …} on stdin and prints {"letters":[{"id","title","body?","link?"}],"state":…}; an empty list means nothing new. timer: no config; one letter every everyMinutes.';

const configSchema = obj({
  repo: opt(str({ description: "github: owner/name." })),
  what: opt(arr(oneOf(["issues", "prs", "releases"] as const))),
  url: opt(str({ description: "rss: the feed's address." })),
  words: opt(
    str({
      description:
        "Words: github and rss keep only items with one of them (comma separated); hn searches them.",
    }),
  ),
  points: opt(int({ minimum: 0, description: "hn: only stories with at least this many points." })),
  command: opt(str({ description: "script: the command line to run." })),
  cwd: opt(str({ description: "script: the folder to run it in." })),
});

const addSchema = obj({
  kind: oneOf(MAILBOX_KINDS, { description: KIND_HELP }),
  name: str({ description: "A short name the owner sees, e.g. 「codex 的新 issue」." }),
  note: str({
    description:
      "One sentence, in the owner's words, of what they care about here; you read it with every letter.",
  }),
  config: opt(configSchema),
  everyMinutes: opt(
    int({ minimum: 1, description: "How often to look; leave out for the default." }),
  ),
});

const changeSchema = obj({
  source: str({ description: "Id (or its first characters) or name of the source." }),
  paused: opt(bool()),
  name: opt(str()),
  note: opt(str()),
  everyMinutes: opt(int({ minimum: 1 })),
});

const removeSchema = obj({ source: str({ description: "Id (or its first characters) or name." }) });

const fileSchema = obj({
  letters: arr(
    obj({
      id: int({ description: "The letter's number." }),
      fate: oneOf(LETTER_FATES, {
        description:
          "now: tell the owner now; digest: the morning digest; noted: not worth their time.",
      }),
      why: str({ description: "A short reason, in the owner's language." }),
    }),
    { minItems: 1 },
  ),
});

type ConfigArgs = {
  repo?: string;
  what?: string[];
  url?: string;
  words?: string;
  points?: number;
  command?: string;
  cwd?: string;
};

/** The config a kind needs, checked so a source that cannot work is refused when it is added. */
export function sourceConfig(kind: MailboxKind, args: ConfigArgs = {}): Record<string, unknown> {
  const words = (args.words ?? "")
    .split(/[,，、]/)
    .map((w) => w.trim())
    .filter((w) => w !== "");
  if (kind === "github") {
    const repo = (args.repo ?? "")
      .trim()
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\/$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("github needs repo as owner/name");
    return {
      repo,
      what: args.what !== undefined && args.what.length > 0 ? args.what : ["issues", "releases"],
      ...(words.length === 0 ? {} : { words }),
    };
  }
  if (kind === "rss") {
    const url = (args.url ?? "").trim();
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("rss needs the feed's url");
    return { url, ...(words.length === 0 ? {} : { words }) };
  }
  if (kind === "hn") {
    const text = (args.words ?? "").trim();
    if (text === "") throw new Error("hn needs words to search");
    return { words: text, ...(args.points === undefined ? {} : { points: args.points }) };
  }
  if (kind === "script") {
    const command = (args.command ?? "").trim();
    if (command === "") throw new Error("script needs a command");
    return { command, ...(args.cwd === undefined ? {} : { cwd: args.cwd }) };
  }
  return {};
}

export function sourceLine(s: MailboxSource): string {
  const state = s.paused
    ? "paused"
    : s.lastError !== undefined
      ? `failing (${s.lastError})`
      : s.started
        ? `ok, last look ${s.lastRunAt?.slice(0, 16) ?? "-"}`
        : "first look pending";
  return `- ${s.id.slice(0, 8)} "${s.name}" (${s.kind}, every ${s.everyMinutes} min, ${s.letters} letters, ${state}) ${JSON.stringify(s.config)} — ${s.note}`;
}

function oneSource(host: HerderHost, query: string): MailboxSource {
  const q = query.trim();
  const all = host.mailboxSources?.() ?? [];
  const found = all.filter((s) => s.id.startsWith(q) || s.name === q || s.name.includes(q));
  const only = found[0];
  if (found.length === 1 && only !== undefined) return only;
  if (found.length === 0) throw new Error(`no mailbox source matches "${query}"; see mailbox_list`);
  throw new Error(
    `several sources match "${query}": ${found.map((s) => `${s.id.slice(0, 8)} "${s.name}"`).join(", ")}`,
  );
}

export function mailboxTools(host: HerderHost, turn: () => TurnContext): AgentTool[] {
  const tools: unknown[] = [];
  if (host.fileLetters !== undefined) {
    const file = host.fileLetters;
    tools.push({
      name: "letters_file",
      label: "File letters",
      description:
        "Only in a turn that brought letters: records for each letter now, digest or noted, with a short reason. Every letter once.",
      parameters: fileSchema,
      execute: async (
        _id: string,
        args: { letters: { id: number; fate: LetterFate; why: string }[] },
      ) => {
        const t = turn();
        if (t.kind !== "letters")
          throw new Error("letters are filed only in the turn that brought them");
        const unknown = file(args.letters);
        for (const l of args.letters) if (!unknown.includes(l.id)) t.filed?.add(l.id);
        const counts = LETTER_FATES.map(
          (f) =>
            `${f} ${args.letters.filter((l) => l.fate === f && !unknown.includes(l.id)).length}`,
        ).join(", ");
        return ok(
          unknown.length === 0
            ? `filed (${counts})`
            : `filed (${counts}); no letter ${unknown.join(", ")}`,
        );
      },
    });
  }
  if (host.addMailboxSource !== undefined && host.mailboxSources !== undefined) {
    const add = host.addMailboxSource;
    tools.push(
      {
        name: "mailbox_list",
        label: "List mailbox sources",
        description:
          "The owner's mailbox sources: what each looks at, how often, and whether it works.",
        parameters: obj({}),
        execute: async () => {
          const all = host.mailboxSources?.() ?? [];
          return ok(all.length === 0 ? "no sources yet" : all.map(sourceLine).join("\n"));
        },
      },
      {
        name: "mailbox_add",
        label: "Add a mailbox source",
        description: `Only when the owner asks to keep an eye on something (「盯一下 openai/codex 的新 issue」「这个博客更新了告诉我」): code looks at it on its own clock, the first look only remembers what is there, and new letters come to you. ${KIND_HELP} Tell the owner in one line what you set up. Never add one they did not ask for.`,
        parameters: addSchema,
        execute: async (
          _id: string,
          args: {
            kind: MailboxKind;
            name: string;
            note: string;
            config?: ConfigArgs;
            everyMinutes?: number;
          },
        ) => {
          ownerAsked(turn, "add mailbox sources");
          const input: MailboxSourceInput = {
            kind: args.kind,
            name: args.name,
            note: args.note,
            config: sourceConfig(args.kind, args.config),
            by: "herder",
            ...(args.everyMinutes === undefined ? {} : { everyMinutes: args.everyMinutes }),
          };
          const s = add(input);
          return ok(`added ${sourceLine(s)}`);
        },
      },
      {
        name: "mailbox_try",
        label: "Try a mailbox source",
        description:
          "Looks at a source once without keeping it: what it would bring now. Use it before adding a script, or to check a repository or feed works.",
        parameters: addSchema,
        execute: async (
          _id: string,
          args: { kind: MailboxKind; name: string; note: string; config?: ConfigArgs },
        ) => {
          if (host.tryMailboxSource === undefined) throw new Error("sources cannot be tried here");
          const letters = await host.tryMailboxSource({
            kind: args.kind,
            name: args.name,
            note: args.note,
            config: sourceConfig(args.kind, args.config),
          });
          if (letters.length === 0) return ok("it works; nothing there right now");
          return ok(
            `it works; it would see ${letters.length} letter(s) now (the first look only remembers them):\n${letters
              .slice(0, 8)
              .map((l) => `- ${l.title}${l.link === undefined ? "" : ` ${l.link}`}`)
              .join("\n")}`,
          );
        },
      },
      {
        name: "mailbox_change",
        label: "Change a mailbox source",
        description:
          "Pauses, resumes, renames a source or changes its note or how often it is looked at, when the owner asks.",
        parameters: changeSchema,
        execute: async (
          _id: string,
          args: {
            source: string;
            paused?: boolean;
            name?: string;
            note?: string;
            everyMinutes?: number;
          },
        ) => {
          ownerAsked(turn, "change mailbox sources");
          const s = oneSource(host, args.source);
          const next = host.changeMailboxSource?.(s.id, {
            ...(args.paused === undefined ? {} : { paused: args.paused }),
            ...(args.name === undefined ? {} : { name: args.name }),
            ...(args.note === undefined ? {} : { note: args.note }),
            ...(args.everyMinutes === undefined ? {} : { everyMinutes: args.everyMinutes }),
          });
          if (next === undefined) throw new Error("sources cannot be changed here");
          return ok(`changed ${sourceLine(next)}`);
        },
      },
      {
        name: "mailbox_remove",
        label: "Remove a mailbox source",
        description: "Removes a source and its letters when the owner no longer wants it.",
        parameters: removeSchema,
        execute: async (_id: string, args: { source: string }) => {
          ownerAsked(turn, "remove mailbox sources");
          const s = oneSource(host, args.source);
          host.removeMailboxSource?.(s.id);
          return ok(`removed "${s.name}"`);
        },
      },
    );
  }
  return tools as AgentTool[];
}
