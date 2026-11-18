import { type HerdUiSpec, herdUiChoices, herdUiFence } from "@agentherd/protocol/herd-ui";
import { describe, expect, it } from "vitest";
import {
  answersIn,
  choiceStarts,
  FOLD_HEIGHT,
  hostOf,
  offersAnswer,
  replyFold,
  replyMarkdown,
  replyParts,
  statColumns,
} from "../src/renderer/src/pet/herd-ui-state";

const first: HerdUiSpec = {
  title: "可选",
  items: [
    { type: "choices", question: "先看哪个？", options: ["签名", "版本"] },
    { type: "text", content: "或者" },
    { type: "choices", options: ["都看"] },
  ],
};
const second: HerdUiSpec = {
  items: [{ type: "choices", question: "下一步？", options: ["下载跑一下", "先不用"] }],
};
const reply = [
  "整理好了：",
  "",
  herdUiFence(first),
  "",
  "再来一个：",
  "",
  herdUiFence(second),
  "",
  "清单在 ~/.agentherd/tasks/b1/list.md",
].join("\n");

describe("replyParts", () => {
  it("keeps a reply without fences as one Markdown part", () => {
    expect(replyParts("就这样。")).toEqual([{ kind: "markdown", text: "就这样。" }]);
    expect(replyParts("  \n")).toEqual([]);
  });

  it("cuts a reply into Markdown and fences, in order", () => {
    const parts = replyParts(reply);
    expect(parts.map((p) => p.kind)).toEqual(["markdown", "ui", "markdown", "ui", "markdown"]);
    const [, a, , b] = parts;
    expect(a?.kind === "ui" && a.spec.title).toBe("可选");
    expect(b?.kind === "ui" && b.spec.items[0]?.type).toBe("choices");
  });

  it("numbers the answers across fences as herdUiChoices does", () => {
    const fences = replyParts(reply).flatMap((p) => (p.kind === "ui" ? [p] : []));
    expect(fences.map((p) => p.firstAction)).toEqual([0, 3]);
    const drawn = fences.flatMap((p) =>
      p.spec.items.flatMap((node, i) => {
        const start = choiceStarts(p.spec, p.firstAction)[i];
        if (node.type !== "choices" || start === undefined) return [];
        return node.options.map((label, k) => ({ action: String(start + k), label }));
      }),
    );
    expect(drawn).toEqual(herdUiChoices(reply).map(({ action, label }) => ({ action, label })));
    expect(drawn.map((c) => c.action)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("leaves out a fence nothing could be read from, without counting its answers", () => {
    const text = ["坏的：", "```herd-ui", "{not json", "```", "", herdUiFence(second)].join("\n");
    const parts = replyParts(text);
    expect(parts.some((p) => p.kind === "ui" && p.firstAction !== 0)).toBe(false);
    expect(parts.filter((p) => p.kind === "ui")).toHaveLength(1);
    expect(parts.map((p) => (p.kind === "markdown" ? p.text : "")).join("")).not.toContain("{not");
  });
});

describe("choiceStarts and answersIn", () => {
  it("gives only choices a first answer", () => {
    expect(choiceStarts(first, 0)).toEqual([0, undefined, 2]);
    expect(choiceStarts(first, 5)).toEqual([5, undefined, 7]);
    expect(answersIn(first)).toBe(3);
    expect(answersIn({ items: [{ type: "divider" }] })).toBe(0);
  });
});

describe("folding and files of a reply with fences", () => {
  const long = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行`).join("\n");

  it("folds every long reply, components or not, unless its answers wait (ADR 0073)", () => {
    const fence = herdUiFence(second);
    expect(replyFold(long)).toEqual({ folded: true, more: 22 });
    // Long words around a fence fold; the line count is not told (components have no lines).
    expect(replyFold(`${long}\n\n${fence}`)).toEqual({ folded: true, more: 0 });
    // Short words fold when the reply is drawn tall (a table, a picture).
    expect(replyFold(`看这个：\n\n${fence}`, 200)).toEqual({ folded: false, more: 0 });
    expect(replyFold(`看这个：\n\n${fence}`, FOLD_HEIGHT + 1)).toEqual({ folded: true, more: 0 });
    expect(replyFold("一张图", FOLD_HEIGHT + 40).folded).toBe(true);
    // Open choices stay in sight.
    expect(replyFold(`${long}\n\n${fence}`, 900, true)).toEqual({ folded: false, more: 0 });
  });

  it("reads only the Markdown, not the JSON", () => {
    const withFile = herdUiFence({
      items: [{ type: "file", path: "~/.agentherd/tasks/b1/inside.md" }],
    });
    const text = `看这个：\n\n${withFile}\n\n还有 ~/.agentherd/tasks/b1/outside.md`;
    expect(replyMarkdown(text)).not.toContain("inside.md");
    expect(replyMarkdown(text)).toContain("outside.md");
    expect(replyMarkdown("没有围栏")).toBe("没有围栏");
  });
});

describe("small helpers", () => {
  it("knows whether a picked answer is among the choices", () => {
    expect(offersAnswer(reply, "先不用")).toBe(true);
    expect(offersAnswer(reply, "我自己打的字")).toBe(false);
  });

  it("names the site of a link", () => {
    expect(hostOf("https://www.github.com/yetone/magpie")).toBe("github.com");
    expect(hostOf("https://mcp.so/server/x")).toBe("mcp.so");
    expect(hostOf("not a url")).toBe("");
  });

  it("lays stats out in rows of up to three, four as two by two", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(statColumns)).toEqual([1, 1, 2, 3, 2, 3, 3]);
  });
});
