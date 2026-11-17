import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel, type SentMessage } from "@agentherd/channel-fake";
import { Herd, Store } from "@agentherd/core";
import type { Inbound, ItemView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { PET_HISTORY_MAX, PetFeed } from "../src/pet.ts";

const BINDING = { channelId: "fake", ownerId: "owner", data: {} };

async function started(echo?: (text: string) => string) {
  let changes = 0;
  const feed = new PetFeed({
    changed: () => changes++,
    ...(echo === undefined ? {} : { echo }),
    now: () => new Date("2026-11-17T12:00:00Z"),
  });
  const fake = new FakeChannel("owner");
  const channel = feed.wrap(fake);
  const inbound: Inbound[] = [];
  await channel.start(BINDING, async (i) => {
    inbound.push(i);
  });
  return { feed, fake, channel, inbound, changes: () => changes };
}

describe("PetFeed (ADR 0070)", () => {
  it("passes everything to the chat and keeps the latest line", async () => {
    const t = await started();
    await t.channel.send({ kind: "text", text: "好的，我开个任务去看。" });
    await t.channel.send({ kind: "text", text: "跑测试", taskLabel: "修登录", tone: "progress" });
    expect(t.fake.messages).toHaveLength(2);
    expect(t.feed.last).toEqual({
      id: 2,
      at: "2026-11-17T12:00:00.000Z",
      kind: "task",
      text: "跑测试",
      task: "修登录",
    });
    await t.channel.send({
      kind: "report",
      taskId: "t1",
      result: "done",
      title: "修登录",
      body: "登录修好了，测试都过了。",
      summarized: false,
      automaticDecisions: [],
    });
    expect(t.feed.last).toMatchObject({ id: 3, kind: "report", result: "done", task: "修登录" });
    await t.channel.send({ kind: "text", text: "出错了", tone: "error" });
    expect(t.feed.last?.kind).toBe("error");
    expect(t.changes()).toBeGreaterThanOrEqual(5);
  });

  it("keeps the board out of the bubble", async () => {
    const t = await started();
    await t.channel.send({ kind: "board", tasks: [], mode: "assist" } as never);
    expect(t.feed.last).toBeUndefined();
  });

  it("lists open cards and drops them once answered", async () => {
    const t = await started();
    const item: ItemView = {
      kind: "item",
      itemId: "i1",
      taskLabel: "清理",
      title: "运行 rm -rf ./*",
      body: "rm -rf ./*",
      risk: "high",
      options: [
        { action: "allow", label: "同意" },
        { action: "deny", label: "拒绝" },
      ],
    };
    const ref = await t.channel.send(item);
    const askRef = await t.channel.send({
      kind: "ask",
      askId: "a1",
      text: "用哪个文件夹？",
      options: [{ action: "0", label: "learnspace" }],
    });
    await t.channel.send({
      kind: "text",
      text: "有 3 个新 issue",
      target: "offer-1",
      options: [{ action: "take", label: "看看" }],
    });
    expect(t.feed.pending().map((p) => p.target)).toEqual(["i1", "a1", "offer-1"]);
    expect(t.feed.pending()[0]).toMatchObject({ task: "清理", body: "rm -rf ./*" });
    expect(t.feed.last).toMatchObject({ kind: "say", text: "有 3 个新 issue" });

    await t.channel.update(ref, { ...item, options: [], final: "你已同意" });
    await t.channel.update(askRef, {
      kind: "ask",
      askId: "a1",
      text: "用哪个文件夹？",
      options: [],
      final: "learnspace",
    });
    expect(t.feed.pending().map((p) => p.target)).toEqual(["offer-1"]);
  });

  it("shows a combined card as one entry with its open lines", async () => {
    const t = await started();
    const line = (n: number, final?: string) => ({
      itemId: `i${n}`,
      n,
      title: `命令 ${n}`,
      body: "",
      risk: "high" as const,
      options: [],
      ...(final === undefined ? {} : { final }),
    });
    await t.channel.send({
      kind: "item",
      itemId: "card",
      title: "3 件事等你",
      body: "",
      risk: "high",
      options: [{ action: "allow-all", label: "都同意" }],
      lines: [line(1), line(2, "你已拒绝"), line(3)],
    });
    expect(t.feed.pending()[0]).toMatchObject({
      target: "card",
      count: 2,
      body: "1. 命令 1\n3. 命令 3",
    });
  });

  it("sends a button press and a typed message as the owner", async () => {
    const t = await started((text) => `（在桌宠里说）${text}`);
    await t.channel.send({
      kind: "item",
      itemId: "i1",
      title: "运行 rm -rf ./*",
      body: "",
      risk: "high",
      options: [{ action: "allow", label: "同意" }],
    });
    await t.feed.press("i1", "allow");
    await t.feed.say("  今天有什么新任务  ");
    expect(t.inbound).toEqual([
      { kind: "action", target: "i1", action: "allow", from: "owner" },
      { kind: "message", text: "今天有什么新任务", from: "owner" },
    ]);
    // The echo goes to the chat but not into the bubble.
    expect(t.fake.messages.at(-1)?.view).toEqual({
      kind: "text",
      text: "（在桌宠里说）今天有什么新任务",
    });
    expect(t.feed.last?.kind).toBe("ask");
  });

  it("keeps the conversation both ways for the expanded pet", async () => {
    const t = await started((text) => `（在桌宠里说）${text}`);
    await t.fake.say("西岸附近有什么好吃的面");
    await t.channel.send({ kind: "text", text: "我开个任务去小红书搜。" });
    const progress = await t.channel.send({
      kind: "text",
      text: "搜索中",
      taskLabel: "面馆",
      tone: "progress",
    });
    await t.feed.say("要走路十分钟以内的");
    await t.fake.say("不是负责人说的", "someone-else");
    await t.fake.tap("nothing", "allow");
    await t.channel.update(progress, {
      kind: "text",
      text: "读了 12 篇笔记",
      taskLabel: "面馆",
      tone: "progress",
    });
    expect(t.feed.history().map((l) => [l.id, l.kind, l.text])).toEqual([
      [1, "owner", "西岸附近有什么好吃的面"],
      [2, "say", "我开个任务去小红书搜。"],
      [3, "task", "读了 12 篇笔记"],
      [4, "owner", "要走路十分钟以内的"],
    ]);
    // The bubble only speaks for AgentHerd; the owner's own words stay out of it.
    expect(t.feed.last).toMatchObject({ id: 3, kind: "task", text: "读了 12 篇笔记" });
    // A message of only a picture still shows up.
    await t.feed.heard("owner", {
      kind: "message",
      text: "",
      from: "owner",
      images: [{ data: "", mimeType: "image/png" }] as never,
    });
    expect(t.feed.history().at(-1)).toMatchObject({ kind: "owner", text: "[图片]" });
  });

  it("keeps only the newest lines", async () => {
    const t = await started();
    for (let i = 1; i <= PET_HISTORY_MAX + 5; i++) {
      await t.channel.send({ kind: "text", text: `第 ${i} 句` });
    }
    const history = t.feed.history();
    expect(history).toHaveLength(PET_HISTORY_MAX);
    expect(history[0]?.text).toBe("第 6 句");
    expect(t.feed.last?.text).toBe(`第 ${PET_HISTORY_MAX + 5} 句`);
  });

  it("refuses stale buttons, empty text and a stopped herd", async () => {
    const t = await started();
    await expect(t.feed.press("gone", "allow")).rejects.toThrow("这件事已经处理过了");
    await expect(t.feed.say("   ")).rejects.toThrow("说点什么再发送");
    await t.channel.send({
      kind: "ask",
      askId: "a1",
      text: "继续吗？",
      options: [{ action: "0", label: "继续" }],
    });
    await t.channel.stop();
    expect(t.feed.connected).toBe(false);
    expect(t.feed.pending()).toEqual([]);
    await expect(t.feed.say("在吗")).rejects.toThrow("还没连上飞书");
  });

  it("a late stop of the old channel leaves the new one alone", async () => {
    const feed = new PetFeed({ changed: () => {} });
    const old = feed.wrap(new FakeChannel("owner"));
    await old.start(BINDING, async () => {});
    const next = feed.wrap(new FakeChannel("owner"));
    await next.start(BINDING, async () => {});
    await old.stop();
    expect(feed.connected).toBe(true);
  });
});

const BIN = fileURLToPath(new URL("../../mock-agent/bin/mock-agent.ts", import.meta.url));
const herds: Herd[] = [];
afterEach(async () => {
  await Promise.all(herds.splice(0).map((h) => h.stop()));
});

describe("E2E-PET-APPROVE (ADR 0070)", () => {
  it("the owner allows a mass delete from the pet and the chat card closes too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-pet-"));
    const script = join(dir, "script.yaml");
    writeFileSync(
      script,
      `
turns:
  - - tool_call: { id: t1, title: "Run rm -rf ./*", kind: execute, command: "rm -rf ./*", status: pending }
    - request_permission:
        toolCall: { id: t1, title: "Run rm -rf ./*", kind: execute, command: "rm -rf ./*" }
        expect: allow
    - message: "done"
    - end_turn: end_turn
`,
    );
    const feed = new PetFeed({ changed: () => {} });
    const fake = new FakeChannel("owner");
    const herd = new Herd({
      home: dir,
      userHome: "/Users/me",
      channel: feed.wrap(fake),
      binding: BINDING,
      mode: "assist",
      locale: "en",
      profiles: [
        {
          id: "mock",
          name: "Mock",
          command: [process.execPath, BIN, "--script", script],
          env: {},
          exporter: null,
        },
      ],
      store: Store.open(":memory:"),
    });
    herds.push(herd);
    await herd.start();
    const run = herd.run("mock", dir, "go");
    const card = await fake.waitFor(
      (m: SentMessage) => m.view.kind === "item" && (m.view as ItemView).final === undefined,
    );
    expect(feed.pending()).toMatchObject([{ target: (card.view as ItemView).itemId }]);
    await feed.press((card.view as ItemView).itemId, "allow");
    const result = await run;
    expect(result.stopReason).toBe("end_turn");
    expect((card.view as ItemView).final).toBe("Allowed by you");
    expect(feed.pending()).toEqual([]);
  });
});
