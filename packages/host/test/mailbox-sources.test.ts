// How the host looks at mailbox sources, and the 信箱 page through the host (ADR 0099).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { Herd, SecretStore } from "@agentherd/core";
import { afterEach, describe, expect, it } from "vitest";
import type { HostEvent } from "../src/api.ts";
import { writeConfig } from "../src/config.ts";
import { Host } from "../src/host.ts";
import {
  feedLetters,
  githubLetters,
  hnLetters,
  mailboxCheck,
  runScript,
  scriptAnswer,
  withWords,
} from "../src/mailbox-sources.ts";

const issues = [
  {
    number: 902,
    title: "Typo in README",
    body: "small",
    html_url: "https://github.com/openai/codex/issues/902",
    user: { login: "a" },
  },
  {
    number: 901,
    title: "Crash on macOS at start",
    body: "It crashes.\n\n\n\nEvery time.",
    html_url: "https://github.com/openai/codex/issues/901",
    user: { login: "b" },
    labels: [{ name: "bug" }],
  },
  {
    number: 900,
    title: "Fix crash",
    body: null,
    html_url: "https://github.com/openai/codex/pull/900",
    pull_request: {},
  },
];
const releases = [
  {
    id: 7,
    tag_name: "v1.2.0",
    name: "v1.2.0",
    body: "notes",
    html_url: "https://github.com/openai/codex/releases/tag/v1.2.0",
  },
  { id: 8, tag_name: "v1.3.0-alpha", name: "Alpha", draft: true },
];

function fakeGh(calls: string[][] = []) {
  return async (args: string[]) => {
    calls.push(args);
    const path = args[1] ?? "";
    if (path.includes("/issues")) return JSON.stringify(issues);
    if (path.includes("/releases")) return JSON.stringify(releases);
    throw new Error(`unexpected ${path}`);
  };
}

describe("looking at mailbox sources (ADR 0099)", () => {
  it("reads a repository's new issues, pull requests and releases, with words", async () => {
    const calls: string[][] = [];
    const all = await githubLetters(fakeGh(calls), {
      repo: "openai/codex",
      what: ["issues", "prs", "releases"],
    });
    expect(all.map((l) => l.id)).toEqual(["issue:902", "issue:901", "pr:900", "release:7"]);
    expect(all[1]).toEqual({
      id: "issue:901",
      title: "#901 Crash on macOS at start",
      body: "@b · 标签：bug\nIt crashes.\n\nEvery time.",
      link: "https://github.com/openai/codex/issues/901",
    });
    expect(all[3]?.title).toBe("发布 v1.2.0");
    expect(calls).toEqual([
      ["api", "repos/openai/codex/issues?state=all&sort=created&direction=desc&per_page=30"],
      ["api", "repos/openai/codex/releases?per_page=10"],
    ]);
    const issuesOnly = await githubLetters(fakeGh(), {
      repo: "openai/codex",
      what: ["issues"],
      words: ["crash"],
    });
    expect(issuesOnly.map((l) => l.id)).toEqual(["issue:901"]);
    await expect(githubLetters(fakeGh(), { repo: "codex" })).rejects.toThrow(/owner\/name/);
  });

  it("reads RSS and Atom feeds", () => {
    const rss = `<?xml version="1.0"?><rss><channel><title>blog</title>
      <item><title><![CDATA[Hello &amp; welcome]]></title><link>https://b.example/1</link>
      <guid>b-1</guid><description>&lt;p&gt;First &lt;b&gt;post&lt;/b&gt;&lt;/p&gt;</description></item>
      <item><title>Second</title><link>https://b.example/2</link></item></channel></rss>`;
    expect(feedLetters(rss)).toEqual([
      { id: "b-1", title: "Hello & welcome", body: "First post", link: "https://b.example/1" },
      { id: "https://b.example/2", title: "Second", body: "", link: "https://b.example/2" },
    ]);
    const atom = `<feed><entry><id>tag:x,1</id><title type="html">Atom one</title>
      <link rel="alternate" href="https://a.example/one"/><summary>short</summary></entry></feed>`;
    expect(feedLetters(atom)).toEqual([
      { id: "tag:x,1", title: "Atom one", body: "short", link: "https://a.example/one" },
    ]);
    expect(withWords(feedLetters(rss), ["second"]).map((l) => l.title)).toEqual(["Second"]);
  });

  it("searches Hacker News by date with a points floor", async () => {
    let asked = "";
    const fetchFn = (async (url: string) => {
      asked = url;
      return new Response(
        JSON.stringify({
          hits: [
            {
              objectID: "41",
              title: "Agent memory",
              url: "https://m.example",
              points: 120,
              num_comments: 30,
            },
            { objectID: "42", title: "Ask HN: memory", url: null, points: 60, num_comments: 2 },
          ],
        }),
      );
    }) as typeof fetch;
    const letters = await hnLetters(fetchFn, { words: "agent memory", points: 50 });
    expect(asked).toBe(
      "https://hn.algolia.com/api/v1/search_by_date?query=agent+memory&tags=story&hitsPerPage=30&numericFilters=points%3E%3D50",
    );
    expect(letters[0]).toEqual({
      id: "hn:41",
      title: "Agent memory",
      body: "120 points · 30 comments · discussion: https://news.ycombinator.com/item?id=41",
      link: "https://m.example",
    });
    expect(letters[1]?.link).toBe("https://news.ycombinator.com/item?id=42");
  });

  it("runs a script with its state on stdin and reads letters and state back", async () => {
    const command = `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=(JSON.parse(s).state??0)+1;console.log(JSON.stringify({letters:[{id:'n'+n,title:'第 '+n+' 封'}],state:n}))})"`;
    const check = mailboxCheck({ gh: fakeGh(), home: tmpdir(), script: runScript });
    const source = {
      id: "s",
      kind: "script" as const,
      name: "count",
      note: "",
      config: { command },
      everyMinutes: 30,
      paused: false,
      by: "owner" as const,
      createdAt: "",
      started: true,
      fails: 0,
      letters: 0,
    };
    expect(await check(source, 4)).toEqual({ letters: [{ id: "n5", title: "第 5 封" }], state: 5 });
    await expect(
      check({ ...source, config: { command: `node -e "process.exit(3)"` } }, undefined),
    ).rejects.toThrow("the script exited with 3");
    expect(scriptAnswer("")).toEqual({ letters: [] });
    expect(scriptAnswer('[{"id":"a","title":"A"}]')).toEqual({
      letters: [{ id: "a", title: "A" }],
    });
    expect(() => scriptAnswer("hello")).toThrow("the script printed no JSON: hello");
  });
});

function memorySecrets(): SecretStore {
  const saved: Record<string, string> = {};
  return {
    get: (a) => saved[a],
    set: (a, v) => {
      saved[a] = v;
    },
    delete: (a) => {
      delete saved[a];
    },
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("the 信箱 page through the host (ADR 0099)", () => {
  it("adds a source, remembers what is there, and shows only what came later", async () => {
    const home = mkdtempSync(join(tmpdir(), "ah-"));
    writeConfig(home, { channel: { channelId: "fake", ownerId: "owner", data: {} } });
    let shown = issues.slice(1);
    const events: HostEvent[] = [];
    const host = new Host({
      home,
      userHome: home,
      secrets: memorySecrets(),
      env: {},
      profiles: () => [],
      createChannel: () => new FakeChannel(),
      gh: async (args) => {
        const path = args[1] ?? "";
        if (path.includes("/issues")) return JSON.stringify(shown);
        return "[]";
      },
    });
    host.onEvent((e) => events.push(e));
    cleanups.push(() => host.stop());
    expect(host.mailbox()).toMatchObject({ on: false, sources: [], letters: [] });
    await expect(host.mailboxAdd({ kind: "rss", name: "x" })).rejects.toThrow(/not running/);
    await host.start();
    const view = host.mailbox();
    expect(view.on).toBe(true);
    expect(view.every.github).toEqual({ min: 5, default: 10 });

    const tried = await host.mailboxTry({
      kind: "github",
      name: "codex",
      repo: "https://github.com/openai/codex",
    });
    expect(tried.map((l) => l.id)).toEqual(["issue:901"]);

    const added = await host.mailboxAdd({
      kind: "github",
      name: "codex",
      note: "macOS 崩溃告诉我",
      repo: "openai/codex",
      what: ["issues"],
    });
    const source = added.sources[0];
    if (source === undefined) throw new Error("no source");
    expect(source).toMatchObject({
      kind: "github",
      by: "owner",
      config: { repo: "openai/codex", what: ["issues"] },
    });
    await host.mailboxRun(source.id);
    expect(host.mailbox().letters).toEqual([]);

    shown = issues;
    const after = await host.mailboxRun(source.id);
    expect(after.letters.map((l) => [l.letterId, l.source, l.kind])).toEqual([
      ["issue:902", "codex", "github"],
    ]);
    expect(events.some((e) => e.topic === "mailbox")).toBe(true);

    const paused = await host.mailboxSet(source.id, { paused: true, note: "只看崩溃" });
    expect(paused.sources[0]).toMatchObject({ paused: true, note: "只看崩溃" });
    await expect(host.mailboxSet(source.id, { fields: { repo: "nope" } })).rejects.toThrow(
      /owner\/name/,
    );
    const herd = (host as unknown as { herd: Herd }).herd;
    expect(herd.store.mailbox.sources()).toHaveLength(1);
    const removed = await host.mailboxRemove(source.id);
    expect(removed.sources).toEqual([]);
    expect(removed.letters).toEqual([]);
  });
});
