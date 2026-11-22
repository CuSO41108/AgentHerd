// The 信箱 page's words and filters (ADR 0099).

import { describe, expect, it } from "vitest";
import { sampleMailbox } from "../src/renderer/src/dev-fixtures.ts";
import {
  draftProblem,
  everyText,
  fateCounts,
  fateOf,
  filterLetters,
  sourceLine,
  sourceState,
  suggestedName,
  whatText,
  whenText,
} from "../src/renderer/src/mailbox.ts";

describe("the 信箱 page (ADR 0099)", () => {
  const view = sampleMailbox(false);
  const [codex, simon, hn, prices] = view.sources as [
    (typeof view.sources)[0],
    (typeof view.sources)[0],
    (typeof view.sources)[0],
    (typeof view.sources)[0],
  ];

  it("says what each source looks at, how often, and whether it works", () => {
    expect(whatText(codex)).toBe("openai/codex 的新 issue、发布");
    expect(whatText(simon)).toBe("https://simonwillison.net/atom/everything/");
    expect(whatText(hn)).toBe("「agent memory」，50 分以上");
    expect(whatText(prices)).toBe("python3 ~/bin/flights.py");
    expect(sourceState(codex)).toEqual({ label: "正常", tone: "green" });
    expect(sourceState(hn)).toEqual({ label: "上次没取到", tone: "red" });
    expect(sourceState({ ...hn, fails: 3 })).toEqual({ label: "连着 3 次没取到", tone: "red" });
    expect(sourceState(prices)).toEqual({ label: "停着", tone: "gray" });
    expect(sourceState({ ...codex, started: false })).toEqual({
      label: "第一次还没看",
      tone: "amber",
    });
    expect(everyText(10)).toBe("每 10 分钟");
    expect(everyText(120)).toBe("每 2 小时");
    expect(everyText(1440)).toBe("每天");
    const now = new Date(codex.lastRunAt ?? "");
    expect(sourceLine(codex, now)).toMatch(
      /^每 10 分钟 · 上次 今天 \d\d:\d\d · 来了 4 封 · 主管加的$/,
    );
    expect(sourceLine({ ...prices, lastRunAt: undefined }, now)).toBe("每 2 小时 · 还没来过信");
  });

  it("shows what became of each letter and filters by it", () => {
    const fates = view.letters.map((l) => fateOf(l).label);
    expect(fates).toEqual([
      "等主管看",
      "留到汇总",
      "告诉你了",
      "留到汇总",
      "已汇总",
      "记下了",
      "记下了",
    ]);
    expect(fateCounts(view.letters)).toEqual({ all: 7, now: 1, digest: 3, noted: 2, waiting: 1 });
    expect(filterLetters(view.letters, "noted").map((l) => l.id)).toEqual([4, 3]);
    expect(filterLetters(view.letters, "all", "m-simon").map((l) => l.id)).toEqual([5, 3]);
    expect(filterLetters(view.letters, "waiting").map((l) => l.id)).toEqual([9]);
    const sent = view.letters[0];
    if (sent === undefined) throw new Error("no letter");
    expect(fateOf({ ...sent, sentAt: "2026-11-22T00:00:00Z" }).label).toBe("主管在看");
  });

  it("tells the owner what is missing before a source can be added", () => {
    expect(draftProblem({ kind: "github", name: "" }, view)).toBe("起个名字");
    expect(draftProblem({ kind: "github", name: "x", repo: "codex" }, view)).toMatch(/owner\/name/);
    expect(
      draftProblem({ kind: "github", name: "x", repo: "https://github.com/openai/codex" }, view),
    ).toBe(undefined);
    expect(draftProblem({ kind: "github", name: "x", repo: "a/b", what: [] }, view)).toMatch(
      /至少选一样/,
    );
    expect(draftProblem({ kind: "rss", name: "x", url: "feed" }, view)).toMatch(/地址/);
    expect(draftProblem({ kind: "hn", name: "x" }, view)).toBe("填要搜的词");
    expect(draftProblem({ kind: "script", name: "x" }, view)).toBe("填要运行的命令");
    expect(draftProblem({ kind: "timer", name: "x" }, view)).toBe("写下到点要主管做什么");
    expect(draftProblem({ kind: "github", name: "x", repo: "a/b", everyMinutes: 2 }, view)).toBe(
      "GitHub 仓库最快每 5 分钟看一次",
    );
    expect(
      suggestedName({ kind: "github", name: "", repo: "https://github.com/openai/codex/" }),
    ).toBe("codex");
    expect(suggestedName({ kind: "rss", name: "", url: "https://www.example.com/feed" })).toBe(
      "example.com",
    );
    expect(suggestedName({ kind: "hn", name: "", words: " agent " })).toBe("HN：agent");
  });

  it("writes times the way people say them", () => {
    const now = new Date(2026, 10, 22, 15, 0);
    expect(whenText(new Date(2026, 10, 22, 9, 5).toISOString(), now)).toBe("今天 09:05");
    expect(whenText(new Date(2026, 10, 21, 23, 0).toISOString(), now)).toBe("昨天 23:00");
    expect(whenText(new Date(2026, 10, 19, 21, 31).toISOString(), now)).toBe("11-19 21:31");
    expect(whenText(undefined, now)).toBe("");
  });
});
