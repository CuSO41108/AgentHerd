import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { ACTIVITY_RESULT_MAX, activityTurns } from "../src/activity.ts";
import { Herder } from "../src/herder.ts";
import { eventsPrompt, nowLine, QUIET, resumedNote, voicePrompt } from "../src/prompt.ts";
import { fakeHost } from "./helpers.ts";

let faux: FauxProviderRegistration[] = [];
afterEach(() => {
  for (const f of faux) f.unregister();
  faux = [];
});

function setup() {
  const registration = registerFauxProvider();
  faux.push(registration);
  const { host, rec } = fakeHost();
  const herder = new Herder({
    host,
    model: registration.getModel(),
    streamFn: streamSimple,
    sleep: async () => {},
  });
  return { herder, rec, faux: registration };
}

const user = (text: string, timestamp = 1000) => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp,
});

describe("the Herder's action log", () => {
  it("reads back a real turn: what started it, each tool with its answer, and the reply", async () => {
    const { herder, rec, faux } = setup();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("session_list", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("session_cancel", { task: "nope" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("现在没有任务在跑。"),
    ]);
    herder.ownerMessage("现在什么情况？");
    await herder.idle();
    herder.ownerAnswer("哪个项目？", "app");
    faux.setResponses([fauxAssistantMessage(QUIET)]);
    await herder.idle();

    const turns = activityTurns(rec.log);
    expect(turns).toHaveLength(2);
    const [first, second] = turns;
    expect(first).toMatchObject({
      trigger: "owner",
      text: "现在什么情况？",
      reply: "现在没有任务在跑。",
      quiet: false,
      resumed: false,
      events: [],
    });
    expect(first?.steps.map((s) => [s.tool, s.error])).toEqual([
      ["session_list", false],
      ["session_cancel", true],
    ]);
    expect(first?.steps[1]?.args).toEqual({ task: "nope" });
    expect(first?.steps[1]?.result).not.toBe("");
    expect(first?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(first?.model).toBeDefined();
    expect(second).toMatchObject({
      trigger: "answer",
      text: "app",
      question: "哪个项目？",
      quiet: true,
      reply: "",
    });
  });

  it("names task results, notices that came along and turns from before a restart", () => {
    const voice = voicePrompt({
      taskId: "e55ca076aaaa",
      title: "修登录",
      result: "done",
      reply: "改好了",
    } as Parameters<typeof voicePrompt>[0]);
    const events = eventsPrompt([
      { kind: "github", taskId: "e55ca076aaaa", title: "修登录", text: "PR #7 was merged." },
    ]);
    const log = [
      user(`${nowLine(0)}\n${events}\n\n${voice}`, 1000),
      { role: "assistant", content: [{ type: "text", text: "登录修好了。" }], timestamp: 3500 },
      user(
        `${nowLine(0)}\n${resumedNote("2026-11-16T08:00:00Z")}\n[Owner's message]\n还在吗\n\n[记忆召回 · 仅供参考]\n- x`,
        5000,
      ),
      {
        role: "assistant",
        content: [{ type: "text", text: '<acp tokens="3" type="text">m00004</acp>\n在。' }],
        timestamp: 6000,
      },
    ];
    const [task, resumed] = activityTurns(log);
    expect(task).toMatchObject({ trigger: "task", text: "修登录", reply: "登录修好了。" });
    expect(task?.events).toEqual([
      'activity on the task\'s pull request: task e55ca076 "修登录" — PR #7 was merged.',
    ]);
    expect(resumed).toMatchObject({
      trigger: "owner",
      text: "还在吗",
      resumed: true,
      reply: "在。",
    });
  });

  it("reads turns saved before the time line and the notice headers of today", () => {
    const notice =
      '- task reported: task d8fb0f19 "看 issue"\n<<<agent\n好了\n\n还有一条\nagent>>>';
    const [old, only] = activityTurns([
      user(`[Events, not from the owner]\n${notice}\n\n[Owner's message]\n链接给我`),
      user(
        `[Events, not from the owner]\n${notice}\n\nUse notify only if the owner needs to know.`,
      ),
    ]);
    expect(old).toMatchObject({
      trigger: "owner",
      text: "链接给我",
      events: ['task reported: task d8fb0f19 "看 issue" — 好了\n\n还有一条'],
    });
    expect(only).toMatchObject({ trigger: "notice", text: "" });
  });

  it("skips what is not a turn and keeps long tool answers short", () => {
    const log = [
      user("[Start of the conversation with the owner.]"),
      "junk",
      user(`${nowLine(0)}\n[Scheduled: "日报", set by the owner on 2026-11-01, due now]\n…`),
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "feed_read", arguments: { source: "arxiv" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "feed_read",
        content: [{ type: "text", text: "x".repeat(ACTIVITY_RESULT_MAX + 10) }],
        isError: false,
        durationMs: 40,
      },
    ];
    const turns = activityTurns(log);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ trigger: "scheduled", text: "日报", reply: "" });
    expect(turns[0]?.steps[0]?.result).toHaveLength(ACTIVITY_RESULT_MAX + 1);
    expect(turns[0]?.steps[0]?.ms).toBe(40);
  });
});
