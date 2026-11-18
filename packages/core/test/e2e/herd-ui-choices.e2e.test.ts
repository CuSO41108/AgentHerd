// E2E-HERD-UI-CHOICES (ADR 0074): a Herder reply whose herd-ui offers choices gets a target; a tap
// on an answer goes to the Herder as the owner's answer, and the reply then shows the pick.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import type { HerderHost } from "../../src/herder-port.ts";
import { CHOICES_OPEN_MAX } from "../../src/owner-commands.ts";
import { Store } from "../../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "agentherd-choices-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

async function setup() {
  const channel = new FakeChannel("owner");
  let host: HerderHost | undefined;
  const answers: [string, string][] = [];
  const store = Store.open(":memory:");
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "zh-CN",
    profiles: [],
    store,
    clock: new FakeClock(),
    herder: (h) => {
      host = h;
      return {
        ownerMessage: () => {},
        ownerAnswer: (q, a) => answers.push([q, a]),
        event: () => {},
        stop: async () => {},
      };
    },
  });
  herds.push(herd);
  await herd.start();
  if (host === undefined) throw new Error("no herder host");
  return { channel, host, answers, store };
}

const REPLY = [
  "找到两个 magpie：",
  "",
  "```herd-ui",
  '{"items":[{"type":"table","columns":["仓库","星"],"rows":[["yetone/magpie","38k"]]},',
  '{"type":"choices","question":"下一步？","options":["下载跑一下","先不用"]}]}',
  "```",
].join("\n");

const texts = (channel: FakeChannel) =>
  channel.messages.filter((m) => m.view.kind === "text").map((m) => m.view as TextView);

describe("E2E-HERD-UI-CHOICES (ADR 0074)", () => {
  it("a tap on an answer goes to the Herder and the reply shows the pick", async () => {
    const { channel, host, answers, store } = await setup();
    await host.say(REPLY);
    const [view] = texts(channel);
    expect(view?.text).toBe(REPLY);
    expect(view?.target).toMatch(/^ui:/);
    expect(view?.options).toBeUndefined();

    await channel.tap(view?.target ?? "", "1");
    expect(answers).toEqual([["下一步？", "先不用"]]);
    expect(texts(channel)[0]?.chosen).toBe("先不用");
    expect(store.auditRows("herder.choice")).toHaveLength(1);

    // Picked once: a second tap is an expired choice.
    await channel.tap(view?.target ?? "", "0");
    expect(answers).toHaveLength(1);
    expect(texts(channel).at(-1)?.text).toBe("这个选项已经过期了，直接告诉我你要哪个吧。");
  });

  it("replies without choices are plain texts, and old choices expire", async () => {
    const { channel, host, answers } = await setup();
    await host.say("现在没有任务。");
    expect(texts(channel)[0]).toEqual({ kind: "text", text: "现在没有任务。" });

    for (let i = 0; i <= CHOICES_OPEN_MAX; i++) await host.say(REPLY);
    const offers = texts(channel).filter((v) => v.target !== undefined);
    await channel.tap(offers[0]?.target ?? "", "0");
    expect(answers).toEqual([]);
    await channel.tap(offers.at(-1)?.target ?? "", "0");
    expect(answers).toEqual([["下一步？", "下载跑一下"]]);
  });

  it("without a question, the reply's first line is what the answer answers", async () => {
    const { channel, host, answers } = await setup();
    await host.say(
      '## 要不要现在装？\n\n```herd-ui\n{"type":"choices","options":["装","不装"]}\n```',
    );
    await channel.tap(texts(channel)[0]?.target ?? "", "0");
    expect(answers).toEqual([["要不要现在装？", "装"]]);
  });
});
