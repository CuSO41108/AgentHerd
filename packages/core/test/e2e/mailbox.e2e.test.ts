// E2E for the Herder's mailbox (ADR 0099): code looks at each source on its own clock; the first
// look only remembers what is there; only letters a source has not brought before go to the
// Herder, together; what the Herder files is kept; the ones it kept for the digest come back once
// a day; a source failing again and again is told to the owner once.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import type { HerderHost } from "../../src/herder-port.ts";
import type { CheckResult, Letter, LetterDelivery, MailboxSource } from "../../src/mailbox.ts";
import { Store } from "../../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "agentherd-mailbox-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

/** A source that answers what the test put in it. */
class FakeSource {
  letters: Letter[] = [];
  fail: string | undefined;
  looks: { source: MailboxSource; state: unknown }[] = [];

  check = async (source: MailboxSource, state: unknown): Promise<CheckResult> => {
    this.looks.push({ source, state });
    if (this.fail !== undefined) throw new Error(this.fail);
    return { letters: this.letters, state: { looks: this.looks.length } };
  };
}

async function setup(opts: { herder?: boolean } = {}) {
  const channel = new FakeChannel("owner");
  const clock = new FakeClock("2026-11-04T00:00:00.000Z");
  const store = Store.open(":memory:");
  const source = new FakeSource();
  const deliveries: LetterDelivery[] = [];
  let host: HerderHost | undefined;
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [],
    store,
    clock,
    boardDebounceMs: 10,
    mailbox: { check: source.check, digestHour: 0 },
    ...(opts.herder === false
      ? {}
      : {
          herder: (h: HerderHost) => {
            host = h;
            return {
              ownerMessage() {},
              ownerAnswer() {},
              event() {},
              letters: (d: LetterDelivery) => deliveries.push(d),
              stop: async () => {},
            };
          },
        }),
  });
  herds.push(herd);
  await herd.start();
  return { herd, channel, clock, store, source, deliveries, host: () => host };
}

const issue = (n: number, title: string): Letter => ({
  id: `issue:${n}`,
  title: `#${n} ${title}`,
  body: "someone wrote this",
  link: `https://github.com/openai/codex/issues/${n}`,
});

const titles = (d: LetterDelivery | undefined) =>
  d?.groups.flatMap((g) => g.letters.map((l) => l.title)) ?? [];

describe("E2E-MAILBOX (ADR 0099)", () => {
  it("remembers what is there on the first look and delivers only new letters, together", async () => {
    const { herd, clock, source, deliveries } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    source.letters = [issue(1, "old one"), issue(2, "old two")];
    const added = mailbox.add({
      kind: "github",
      name: "codex",
      note: "Tell me about crashes on macOS.",
      config: { repo: "openai/codex" },
    });
    expect(added.everyMinutes).toBe(10);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(1);
    expect(deliveries).toEqual([]);
    expect(mailbox.list()[0]?.started).toBe(true);

    // Not due yet: no look.
    source.letters = [issue(3, "crash on start"), ...source.letters];
    await clock.advance(5 * 60_000);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(1);

    await clock.advance(5 * 60_000);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(2);
    expect(source.looks[1]?.state).toEqual({ looks: 1 });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.kind).toBe("new");
    expect(deliveries[0]?.groups[0]).toMatchObject({
      name: "codex",
      kind: "github",
      note: "Tell me about crashes on macOS.",
    });
    expect(titles(deliveries[0])).toEqual(["#3 crash on start"]);

    // The same letters again: nothing new.
    await clock.advance(10 * 60_000);
    await herd.checkMailbox();
    expect(deliveries).toHaveLength(1);
    expect(mailbox.letters()).toHaveLength(1);
  });

  it("keeps what the Herder made of each letter and brings the digest ones back once a day", async () => {
    const { herd, clock, source, deliveries, host } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    mailbox.add({ kind: "rss", name: "blog", config: { url: "https://example.com/feed" } });
    await herd.checkMailbox();
    source.letters = [issue(7, "a post"), issue(8, "another")];
    await clock.advance(60 * 60_000);
    await herd.checkMailbox();
    const [a, b] = deliveries[0]?.groups[0]?.letters ?? [];
    if (a === undefined || b === undefined) throw new Error("no letters");
    expect(
      host()?.fileLetters?.([
        { id: a.id, fate: "digest", why: "worth a look in the morning" },
        { id: b.id, fate: "noted", why: "nothing new" },
        { id: 999, fate: "now", why: "?" },
      ]),
    ).toEqual([999]);
    expect(() => host()?.fileLetters?.([{ id: a.id, fate: "later" as never, why: "" }])).toThrow(
      /fate must be one of/,
    );
    expect(mailbox.letters().map((l) => [l.title, l.fate, l.why])).toEqual([
      ["#8 another", "noted", "nothing new"],
      ["#7 a post", "digest", "worth a look in the morning"],
    ]);

    // The digest went out (empty) on the first tick today; tomorrow the kept one comes back.
    await clock.advance(24 * 60 * 60_000);
    await herd.checkMailbox();
    const digest = deliveries.find((d) => d.kind === "digest");
    expect(titles(digest)).toEqual(["#7 a post"]);
    await clock.advance(60 * 60_000);
    await herd.checkMailbox();
    expect(deliveries.filter((d) => d.kind === "digest")).toHaveLength(1);
  });

  it("tells the owner once when a source keeps failing, and a paused one is not looked at", async () => {
    const { herd, channel, clock, source } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    const s = mailbox.add({ kind: "hn", name: "agents on HN", config: { words: "agent" } });
    source.fail = "Hacker News did not answer";
    await herd.checkMailbox();
    for (let i = 0; i < 4; i++) {
      await clock.advance(60 * 60_000);
      await herd.checkMailbox();
    }
    const said = channel.messages
      .filter((m) => m.view.kind === "text")
      .map((m) => (m.view as TextView).text)
      .filter((t) => t.includes("agents on HN"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("failed 3 looks in a row: Hacker News did not answer");
    expect(mailbox.list()[0]).toMatchObject({ fails: 5, lastError: "Hacker News did not answer" });

    mailbox.set(s.id, { paused: true });
    const looks = source.looks.length;
    await clock.advance(2 * 60 * 60_000);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(looks);
  });

  it("a timer brings one letter when it is due; a try keeps nothing; changing the source starts it over", async () => {
    const { herd, clock, source, deliveries } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    mailbox.add({
      kind: "timer",
      name: "看看今天的 issue",
      note: "every morning",
      everyMinutes: 60,
    });
    await herd.checkMailbox();
    expect(deliveries).toEqual([]);
    await clock.advance(60 * 60_000);
    await herd.checkMailbox();
    expect(titles(deliveries[0])).toEqual(["看看今天的 issue"]);
    expect(source.looks).toHaveLength(0);

    source.letters = [issue(1, "one"), { id: "", title: "no id" } as Letter];
    const tried = await mailbox.tryOut({ kind: "script", name: "mine", config: { command: "x" } });
    expect(tried.map((l) => l.title)).toEqual(["#1 one"]);
    expect(mailbox.letters()).toHaveLength(1);

    const gh = mailbox.add({ kind: "github", name: "repo", config: { repo: "a/b" } });
    await herd.checkMailbox();
    expect(mailbox.list().find((s) => s.id === gh.id)?.started).toBe(true);
    mailbox.set(gh.id, { config: { repo: "a/c" } });
    await herd.checkMailbox();
    // A new first look: what a/c has now is only remembered.
    expect(deliveries).toHaveLength(1);
    expect(() => mailbox.add({ kind: "github", name: "x", everyMinutes: 1 })).toThrow(
      /every 5 minutes at most/,
    );
    expect(() => mailbox.add({ kind: "mail" as never, name: "x" })).toThrow(/kind must be/);
  });

  it("letters wait while there is no Herder", async () => {
    const { herd, clock, source, store } = await setup({ herder: false });
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    mailbox.add({ kind: "github", name: "codex", config: { repo: "openai/codex" } });
    await herd.checkMailbox();
    source.letters = [issue(5, "new")];
    await clock.advance(10 * 60_000);
    await herd.checkMailbox();
    expect(store.mailbox.unsent(10).map((l) => l.title)).toEqual(["#5 new"]);
  });
});
