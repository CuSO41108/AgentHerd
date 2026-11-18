// Herd-ui fences in a Herder reply are drawn as Feishu card elements (ADR 0074).
import { herdUiChoices } from "@agentherd/protocol/herd-ui";
import { describe, expect, it } from "vitest";
import type { FeishuApi } from "../src/api.ts";
import { FOLD_CHARS, renderCard, renderText } from "../src/card.ts";
import { FeishuChannel } from "../src/channel.ts";
import { HERD_UI_TABLE_MAX, herdUiElements } from "../src/herd-ui-card.ts";
import { parseCardAction } from "../src/inbound.ts";
import { CARD_TEXTS } from "../src/texts.ts";
import { bodyElements, buttonValue, makeReport, must } from "./card-helpers.ts";

const t = CARD_TEXTS["zh-CN"];
const fence = (spec: unknown) => `\`\`\`herd-ui\n${JSON.stringify(spec)}\n\`\`\``;
const one = (node: Record<string, unknown>) => herdUiElements(fence({ items: [node] }), { t });
const content = (e: Record<string, unknown> | undefined) => must(e).content as string;

/** Every tag in a card, nested ones included. */
function tags(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) tags(v, out);
  else if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.tag === "string") out.add(o.tag);
    for (const v of Object.values(o)) tags(v, out);
  }
  return out;
}

/** The {target, action} values of every callback in a card. */
function callbacks(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) for (const v of value) callbacks(v, out);
  else if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (o.type === "callback") out.push(o.value as Record<string, unknown>);
    for (const v of Object.values(o)) callbacks(v, out);
  }
  return out;
}

describe("herd-ui components as Feishu elements", () => {
  it("a title is a bold line before the components", () => {
    const e = herdUiElements(fence({ title: "可选", items: [{ type: "text", content: "x" }] }), {
      t,
    });
    expect(e).toEqual([
      { tag: "markdown", content: "**可选**" },
      { tag: "markdown", content: "x" },
    ]);
  });

  it("a text is Markdown, and a long one is folded on its own", () => {
    const long = "长".repeat(FOLD_CHARS + 50);
    const e = one({ type: "text", content: long });
    expect(e.map((x) => x.tag)).toEqual(["markdown", "collapsible_panel"]);
    expect(content(e[0]).endsWith("…")).toBe(true);
  });

  it("a table is a Feishu table with columns c0…cN and rows as objects", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`repo${i}`, `${i}k`]);
    const [table] = one({ type: "table", columns: ["仓库", "星"], rows });
    expect(table).toMatchObject({
      tag: "table",
      page_size: 10,
      columns: [
        { name: "c0", display_name: "仓库", data_type: "lark_md" },
        { name: "c1", display_name: "星", data_type: "lark_md" },
      ],
    });
    const data = must(table).rows as Record<string, string>[];
    expect(data).toHaveLength(12);
    expect(data[0]).toEqual({ c0: "repo0", c1: "0k" });
    expect(must(one({ type: "table", columns: ["a"], rows: [["1"]] })[0]).page_size).toBe(1);
  });

  it("past five tables in one card, the next ones are Markdown tables", () => {
    const tables = Array.from({ length: 7 }, (_, i) => ({
      type: "table",
      columns: ["名", "值"],
      rows: [[`r${i}`, `${i}`]],
    }));
    const text = `${fence({ items: tables.slice(0, 3) })}\n\n中间\n\n${fence({ items: tables.slice(3) })}`;
    const out = bodyElements(renderCard({ kind: "text", text }, "zh-CN"));
    expect(out.map((e) => e.tag)).toEqual([
      "table",
      "table",
      "table",
      "markdown",
      "table",
      "table",
      "markdown",
      "markdown",
    ]);
    expect(out.filter((e) => e.tag === "table")).toHaveLength(HERD_UI_TABLE_MAX);
    expect(out.slice(-2).map(content)).toEqual([
      "| 名 | 值 |\n| --- | --- |\n| r5 | 5 |",
      "| 名 | 值 |\n| --- | --- |\n| r6 | 6 |",
    ]);
  });

  it("pairs are bold keys with their values", () => {
    const e = one({
      type: "keyvalue",
      pairs: [
        { key: "分支", value: "main" },
        { key: "状态", value: "ok" },
      ],
    });
    expect(e).toEqual([{ tag: "markdown", content: "**分支**：main\n**状态**：ok" }]);
  });

  it("numbers stand side by side, four to a row, value bold over a grey label and hint", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, value: `${i}` }));
    items[0] = { label: "星", value: "38k", hint: "本周 +2k" } as (typeof items)[0];
    const e = one({ type: "stats", items });
    expect(e.map((x) => x.tag)).toEqual(["column_set", "column_set"]);
    const columns = must(e[0]).columns as Record<string, unknown>[];
    expect(columns).toHaveLength(4);
    expect((must(e[1]).columns as unknown[]).length).toBe(1);
    expect(columns[0]).toMatchObject({ tag: "column", width: "weighted", weight: 1 });
    const first = must((must(columns[0]).elements as Record<string, unknown>[])[0]);
    expect(first.content).toBe(
      "**38k**\n<font color='grey'>星</font>\n<font color='grey'>本周 +2k</font>",
    );
  });

  it("steps are numbered; with a status each gets a mark and the current one is bold", () => {
    const [marked] = one({
      type: "steps",
      steps: [
        { title: "克隆", status: "done" },
        { title: "安装", status: "doing", desc: "pnpm i" },
        { title: "跑起来" },
      ],
    });
    expect(content(marked)).toBe(
      "✅ 1. 克隆\n⏳ 2. **安装**\n<font color='grey'>pnpm i</font>\n◻️ 3. 跑起来",
    );
    const [plain] = one({ type: "steps", steps: [{ title: "a" }, { title: "b" }] });
    expect(content(plain)).toBe("1. a\n2. b");
  });

  it("a list is a Markdown list, numbered when ordered", () => {
    expect(content(one({ type: "list", items: ["a", "b"] })[0])).toBe("- a\n- b");
    expect(content(one({ type: "list", items: ["a", "b"], ordered: true })[0])).toBe("1. a\n2. b");
  });

  it("a callout starts with its tone's icon and a bold title", () => {
    expect(
      content(one({ type: "callout", tone: "warning", title: "注意", content: "会删文件" })[0]),
    ).toBe("⚠️ **注意**\n会删文件");
    expect(content(one({ type: "callout", tone: "error", content: "失败了" })[0])).toBe(
      "❌ 失败了",
    );
    expect(content(one({ type: "callout", tone: "success", content: "好了" })[0])).toBe("✅ 好了");
    expect(content(one({ type: "callout", content: "提示" })[0])).toBe("ℹ️ 提示");
  });

  it("code is a fenced block that a ``` inside cannot close", () => {
    const [code] = one({ type: "code", lang: "ts", code: "const a = 1;\n```\nx" });
    expect(content(code)).toBe("```ts\nconst a = 1;\n``\u200B`\nx\n```");
  });

  it("a link is a bordered box that opens the address", () => {
    const [box] = one({
      type: "link",
      url: "https://github.com/yetone/magpie",
      title: "yetone/magpie",
      meta: "★ 38k",
      desc: "一个小工具",
    });
    expect(box).toMatchObject({
      tag: "interactive_container",
      width: "fill",
      behaviors: [{ type: "open_url", default_url: "https://github.com/yetone/magpie" }],
    });
    const text = content((must(box).elements as Record<string, unknown>[])[0]);
    expect(text).toContain("**yetone/magpie**");
    expect(text).toContain("<font color='grey'>★ 38k</font>");
    expect(text).toContain("一个小工具");
    expect(text).toContain("github.com/yetone/magpie");
  });

  it("a file shows its name and its path as text", () => {
    const [f] = one({ type: "file", path: "/Users/me/notes/plan_v2.md", desc: "计划" });
    expect(content(f)).toBe(
      "📄 **plan_v2.md**\n<font color='grey'>/Users/me/notes/plan\\_v2.md</font>\n计划",
    );
    expect(content(one({ type: "file", path: "~/a.txt", title: "说明" })[0])).toContain(
      "📄 **说明**",
    );
  });

  it("a divider is a rule, with its label in grey before it", () => {
    expect(one({ type: "divider" })).toEqual([{ tag: "hr" }]);
    expect(one({ type: "divider", label: "备选" })).toEqual([
      { tag: "markdown", content: "<font color='grey'>备选</font>" },
      { tag: "hr" },
    ]);
  });
});

describe("herd-ui choices in Feishu", () => {
  const two =
    `先看一下：\n\n${fence({ items: [{ type: "choices", question: "下一步？", options: ["下载跑一下", "先不用"] }] })}` +
    `\n\n还有：\n\n${fence({ items: [{ type: "choices", options: ["/Users/me/learnspace/PI-Desktop", "其他"] }] })}`;

  it("with a target, each answer is a button whose value the inbound parser reads", () => {
    const card = renderCard({ kind: "text", text: two, target: "ui:abc" }, "zh-CN");
    const elements = bodyElements(card);
    expect(elements.map((e) => e.tag)).toEqual([
      "markdown",
      "markdown",
      "column_set",
      "column_set",
      "markdown",
      "interactive_container",
      "column_set",
    ]);
    expect(content(elements[1])).toBe("下一步？");
    const value = buttonValue(must(elements[2]));
    expect(value).toEqual({ target: "ui:abc", action: "0" });
    const inbound = parseCardAction({ operator: { open_id: "ou_owner" }, action: { value } });
    expect(inbound).toEqual({ kind: "action", target: "ui:abc", action: "0", from: "ou_owner" });
  });

  it("answers are numbered across the whole reply, as herdUiChoices counts them", () => {
    const card = renderCard({ kind: "text", text: two, target: "ui:abc" }, "zh-CN");
    expect(callbacks(card)).toEqual(
      herdUiChoices(two).map((c) => ({ target: "ui:abc", action: c.action })),
    );
    expect(callbacks(card).map((v) => v.action)).toEqual(["0", "1", "2", "3"]);
    // The long path is a whole-width box that sends answer 2.
    const box = must(bodyElements(card)[5]);
    expect(box.behaviors).toEqual([{ type: "callback", value: { target: "ui:abc", action: "2" } }]);
  });

  it("after the owner picked, the pick shows under its question and no buttons are left", () => {
    const card = renderCard({ kind: "text", text: two, target: "ui:abc", chosen: "其他" }, "zh-CN");
    expect(callbacks(card)).toEqual([]);
    const texts = bodyElements(card).map((e) => e.content);
    expect(texts).toEqual(["先看一下：", "下一步？", "还有：", "你选了：**其他**"]);
    // An answer typed rather than picked still shows, after the last question.
    const typed = renderCard(
      { kind: "text", text: two, target: "ui:abc", chosen: "改天" },
      "zh-CN",
    );
    expect(bodyElements(typed).at(-1)?.content).toBe("你选了：**改天**");
    expect(JSON.stringify(typed).match(/你选了/g)).toHaveLength(1);
  });

  it("without a target, the answers are a plain list", () => {
    const card = renderCard({ kind: "text", text: two }, "zh-CN");
    expect(callbacks(card)).toEqual([]);
    expect(bodyElements(card).map((e) => e.content)).toContain("- 下载跑一下\n- 先不用");
  });

  it("a report body draws its fences, and its choices are a list", () => {
    const card = renderCard(makeReport({ body: two }), "zh-CN");
    const elements = bodyElements(card);
    expect(elements.map((e) => e.content)).toContain("- 下载跑一下\n- 先不用");
    expect(callbacks(card)).toEqual([]);
  });
});

describe("herd-ui replies as a whole", () => {
  it("a broken fence is left out and the text around it stays", () => {
    const text = `开头\n\n\`\`\`herd-ui\n这根本不是 JSON\n\`\`\`\n\n结尾\n\n${fence({ items: [{ type: "list", items: ["x"] }] })}`;
    const card = renderCard({ kind: "text", text }, "zh-CN");
    expect(bodyElements(card).map((e) => e.content)).toEqual(["开头", "结尾", "- x"]);
    expect(JSON.stringify(card)).not.toContain("不是 JSON");
  });

  it("a reply that is only a broken fence says it could not be shown", () => {
    const card = renderCard({ kind: "text", text: "```herd-ui\n{oops\n```" }, "zh-CN");
    expect(bodyElements(card)).toEqual([{ tag: "markdown", content: t.herdUiUnreadable }]);
  });

  it("with fences the reply is not folded as a whole, though a long Markdown part still is", () => {
    const intro = "介".repeat(FOLD_CHARS + 10);
    const text = `${intro}\n\n${fence({ items: [{ type: "list", items: ["x"] }] })}\n\n短结尾`;
    const elements = bodyElements(renderCard({ kind: "text", text }, "zh-CN"));
    expect(elements.map((e) => e.tag)).toEqual([
      "markdown",
      "collapsible_panel",
      "markdown",
      "markdown",
    ]);
    const panel = must(elements[1]).elements as Record<string, unknown>[];
    expect(content(panel[0])).toBe(intro);
    expect(elements.at(-1)?.content).toBe("短结尾");
  });

  it("a reply with every component uses only elements Feishu cards know", () => {
    const text = fence({
      title: "全部",
      items: [
        { type: "text", content: "t" },
        { type: "table", columns: ["a"], rows: [["1"]] },
        { type: "keyvalue", pairs: [{ key: "k", value: "v" }] },
        { type: "stats", items: [{ label: "l", value: "1" }] },
        { type: "steps", steps: [{ title: "s" }] },
        { type: "list", items: ["i"] },
        { type: "callout", tone: "info", content: "c" },
        { type: "code", code: "x" },
        { type: "link", url: "https://example.com", title: "e" },
        { type: "file", path: "/tmp/a" },
        { type: "choices", options: ["好", "/a/very/long/path/that/wraps"] },
        { type: "divider", label: "d" },
      ],
    });
    const card = renderCard({ kind: "text", text, target: "ui:1" }, "zh-CN");
    expect([...tags(card)].sort()).toEqual(
      [
        "button",
        "column",
        "column_set",
        "hr",
        "interactive_container",
        "markdown",
        "plain_text",
        "table",
      ].sort(),
    );
    expect(JSON.stringify(card)).not.toContain("herd-ui");
  });

  it("text without a fence renders exactly as before", () => {
    const plain = renderCard({ kind: "text", text: "普通的一句话" }, "zh-CN");
    expect(bodyElements(plain)).toEqual([{ tag: "markdown", content: "普通的一句话" }]);
    const json = renderCard({ kind: "text", text: "```json\n{}\n```" }, "zh-CN");
    expect(bodyElements(json)).toEqual([{ tag: "markdown", content: "```json\n{}\n```" }]);
  });
});

describe("a fenced reply never goes out as plain text", () => {
  it("the channel sends it as a card with components, not the JSON", async () => {
    const sent: Record<string, unknown>[] = [];
    const api: FeishuApi = {
      connect: async () => {},
      close: async () => {},
      sendCard: async (_id, card) => {
        sent.push(card);
        return "om_1";
      },
      patchCard: async () => {},
      pin: async () => {},
      downloadImage: async () => ({ data: new Uint8Array() }),
      downloadFile: async () => ({ data: new Uint8Array() }),
    };
    const channel = new FeishuChannel({
      getSecret: async () => "s",
      saveSecret: async () => {},
      createApi: () => api,
    });
    await channel.start(
      { channelId: "feishu", ownerId: "ou_owner", data: { appId: "cli_1" } },
      async () => {},
    );
    const text = `好的：\n\n${fence({ items: [{ type: "table", columns: ["仓库"], rows: [["x"]] }] })}`;
    await channel.send({ kind: "text", text });
    expect(sent).toHaveLength(1);
    expect(tags(sent[0]).has("table")).toBe(true);
    expect(JSON.stringify(sent[0])).not.toContain("herd-ui");
  });

  it("a plain line writes the fences as Markdown", () => {
    const text = `看：\n\n${fence({ items: [{ type: "list", items: ["a"] }] })}`;
    expect(renderText({ kind: "text", text })).toBe("看：\n\n- a");
    expect(renderText({ kind: "text", text, taskLabel: "构建" })).toBe("[构建] 看：\n\n- a");
  });
});
