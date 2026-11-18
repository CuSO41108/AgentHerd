import { describe, expect, it } from "vitest";
import {
  checkHerdUi,
  HERD_UI_CHOICES_MAX,
  HERD_UI_IMAGES_MAX,
  HERD_UI_MAX_NODES,
  herdUiChoices,
  herdUiImages,
  herdUiImageType,
  herdUiPlain,
  parseLooseJson,
  readHerdUi,
  splitHerdUi,
} from "../src/herd-ui.ts";

const fence = (body: string) => `\`\`\`herd-ui\n${body}\n\`\`\``;

describe("reading a herd-ui fence (ADR 0074)", () => {
  it("reads every component as written", () => {
    const read = readHerdUi(
      JSON.stringify({
        title: "magpie",
        items: [
          { type: "text", content: "**两个**都在维护" },
          { type: "table", columns: ["仓库", "星"], rows: [["yetone/magpie", "38k"]] },
          { type: "keyvalue", pairs: [{ key: "版本", value: "v0.1.4440" }] },
          { type: "stats", items: [{ label: "star", value: "38,328", hint: "本周 +1.2k" }] },
          {
            type: "steps",
            steps: [
              { title: "下载", status: "done" },
              { title: "启动", status: "doing" },
            ],
          },
          { type: "list", items: ["a", "b"], ordered: true },
          { type: "callout", tone: "warning", title: "注意", content: "要 macOS 14" },
          { type: "code", code: "brew install magpie", lang: "sh" },
          {
            type: "link",
            url: "https://github.com/yetone/magpie",
            title: "yetone/magpie",
            meta: "★ 38k",
          },
          { type: "file", path: "~/.agentherd/tasks/b1/list.md" },
          { type: "choices", question: "下一步？", options: ["下载跑一下", "先不用"] },
          { type: "divider", label: "备注" },
        ],
      }),
    );
    expect(read.problems).toEqual([]);
    expect(read.spec?.title).toBe("magpie");
    expect(read.spec?.items.map((n) => n.type)).toEqual([
      "text",
      "table",
      "keyvalue",
      "stats",
      "steps",
      "list",
      "callout",
      "code",
      "link",
      "file",
      "choices",
      "divider",
    ]);
  });

  it("repairs the JSON slips small models make", () => {
    const loose = `{
      // a comment
      items: [
        {"type": "text", "content": "第一行
第二行",},
        {"type": "list", "items": ["a", "b",]},
      ],
    `;
    const read = readHerdUi(loose);
    expect(read.repaired).toBe(true);
    expect(read.spec?.items).toEqual([
      { type: "text", content: "第一行\n第二行" },
      { type: "list", items: ["a", "b"] },
    ]);
    expect(read.problems).toContain("the JSON had to be repaired");
    // Chinese curly quotes inside a string stay words.
    expect(parseLooseJson('{"items":[{"type":"text","content":"他说“好”"},]}').value).toEqual({
      items: [{ type: "text", content: "他说“好”" }],
    });
    expect(parseLooseJson("{“items”: []}").value).toEqual({ items: [] });
    expect(parseLooseJson("{a: True, b: None}").value).toEqual({ a: true, b: null });
  });

  it("takes the names a model means for types and fields", () => {
    const read = readHerdUi(
      JSON.stringify([
        { type: "markdown", text: "hi" },
        { type: "kv", items: [{ label: "模型", value: "flash" }] },
        { type: "kv", data: { 位置: "传媒港 B1" } },
        { type: "metric", label: "完成", value: 3 },
        { type: "timeline", items: ["下载", { name: "启动", state: "in_progress" }] },
        { type: "alert", level: "danger", message: "删了就回不来" },
        { type: "repo", href: "https://github.com/a/b", name: "a/b", description: "x" },
        { type: "buttons", buttons: [{ label: "要" }, { text: "不要" }, "要"] },
        { type: "table", rows: [{ 名字: "阿娘面", 距离: "5 分钟" }] },
        { type: "hr" },
      ]),
    );
    expect(read.spec?.items).toEqual([
      { type: "text", content: "hi" },
      { type: "keyvalue", pairs: [{ key: "模型", value: "flash" }] },
      { type: "keyvalue", pairs: [{ key: "位置", value: "传媒港 B1" }] },
      { type: "stats", items: [{ label: "完成", value: "3" }] },
      { type: "steps", steps: [{ title: "下载" }, { title: "启动", status: "doing" }] },
      { type: "callout", tone: "error", content: "删了就回不来" },
      { type: "link", url: "https://github.com/a/b", title: "a/b", desc: "x" },
      { type: "choices", options: ["要", "不要"] },
      { type: "table", columns: ["名字", "距离"], rows: [["阿娘面", "5 分钟"]] },
      { type: "divider" },
    ]);
    expect(read.problems).toContain('items[0]: type "markdown" read as "text"');
  });

  it("drops what it cannot use and says why, keeping the rest", () => {
    const read = readHerdUi(
      JSON.stringify({
        items: [
          { type: "chart", data: [1, 2] },
          { type: "gauge", title: "进度 60%" },
          { type: "link", url: "javascript:alert(1)", title: "x" },
          { type: "file", path: "list.md" },
          { type: "table", columns: ["a"] },
          { type: "text", content: "留下的" },
        ],
      }),
    );
    expect(read.spec?.items).toEqual([
      { type: "text", content: "进度 60%" },
      { type: "text", content: "留下的" },
    ]);
    expect(read.problems.join("\n")).toMatch(/items\[0\]: unknown type "chart"; dropped/);
    expect(read.problems.join("\n")).toMatch(/items\[2\] \(link\): .* not an http\(s\) link/);
    expect(read.problems.join("\n")).toMatch(/items\[3\] \(file\): .* not a full path/);
    expect(read.problems.join("\n")).toMatch(/items\[4\] \(table\): missing "rows"/);
  });

  it("keeps components within their limits", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ type: "text", content: `${i}` }));
    const read = readHerdUi(JSON.stringify({ items: many }));
    expect(read.spec?.items).toHaveLength(HERD_UI_MAX_NODES);
    const choices = readHerdUi(
      JSON.stringify({
        type: "choices",
        options: [
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "这一个选项写得实在是太长了，超过了按钮能放下的四十个字，所以会被截短一些",
        ],
      }),
    );
    const node = choices.spec?.items[0];
    expect(node?.type === "choices" ? node.options.length : 0).toBe(HERD_UI_CHOICES_MAX);
  });

  it("gives up on what is not JSON at all", () => {
    expect(readHerdUi("这不是 JSON").spec).toBeUndefined();
    expect(readHerdUi('{"items": []}').problems).toContain("nothing usable in it");
  });
});

describe("fences in a reply (ADR 0074)", () => {
  const ui = fence('{"items":[{"type":"choices","options":["要","不要"]}]}');

  it("cuts a reply into Markdown and fences, even one cut off at the end", () => {
    const text = `先看结果：\n\n${ui}\n\n要我接着做吗？\n\n\`\`\`herd-ui\n{"items":[{"type":"list","items":["x"]`;
    const parts = splitHerdUi(text);
    expect(parts.map((p) => p.kind)).toEqual(["markdown", "ui", "markdown", "ui"]);
    expect(parts[0]).toEqual({ kind: "markdown", text: "先看结果：" });
    // Other fences stay Markdown.
    expect(splitHerdUi("```json\n{}\n```").map((p) => p.kind)).toEqual(["markdown"]);
  });

  it("writes usable fences back clean and leaves broken ones out", () => {
    const check = checkHerdUi(`好的。\n\n${fence("{items: [{type: 'x'")}\n\n${ui}`);
    expect(check.fences).toBe(2);
    expect(check.broken).toBe(1);
    expect(check.text).toBe(
      `好的。\n\n${fence('{"items":[{"type":"choices","options":["要","不要"]}]}')}`,
    );
    expect(check.problems[0]).toMatch(/^fence 1: /);
    expect(checkHerdUi("没有围栏")).toEqual({
      text: "没有围栏",
      broken: 0,
      fences: 0,
      problems: [],
    });
  });

  it("reads as plain text where nothing is drawn, and numbers the answers", () => {
    const text = `找到两个：\n\n${fence(
      JSON.stringify({
        items: [
          { type: "table", columns: ["仓库", "星"], rows: [["a/b", "1|2"]] },
          { type: "choices", question: "下一步？", options: ["下载", "不用"] },
          { type: "choices", options: ["再搜"] },
        ],
      }),
    )}`;
    expect(herdUiPlain(text)).toBe(
      "找到两个：\n\n| 仓库 | 星 |\n| --- | --- |\n| a/b | 1\\|2 |\n\n下一步？\n- 下载\n- 不用\n\n- 再搜",
    );
    expect(herdUiChoices(text)).toEqual([
      { action: "0", label: "下载", question: "下一步？" },
      { action: "1", label: "不用", question: "下一步？" },
      { action: "2", label: "再搜" },
    ]);
    expect(herdUiChoices("没有")).toEqual([]);
  });
});

describe("pictures (ADR 0075)", () => {
  const read = (items: unknown[]) => readHerdUi(JSON.stringify({ items }));

  it("reads a picture on this computer and names it in plain text", () => {
    const r = read([
      { type: "qrcode", src: "/tmp/qr.png", caption: "授权码", desc: "10 分钟内有效" },
    ]);
    expect(r.spec?.items).toEqual([
      { type: "image", path: "/tmp/qr.png", title: "授权码", desc: "10 分钟内有效" },
    ]);
    const text = `扫码：\n\n${fence(JSON.stringify(r.spec))}`;
    expect(herdUiPlain(text)).toContain("🖼️ 授权码：/tmp/qr.png");
    expect(herdUiImages(text)).toEqual(["/tmp/qr.png"]);
    expect(herdUiImages("没有图")).toEqual([]);
  });

  it("shows a picture whether the model wrote image or file, and anything else as a file", () => {
    const r = read([
      { type: "file", path: "~/Desktop/shot.PNG" },
      { type: "image", path: "/tmp/report.pdf" },
      { type: "image", url: "https://example.com/a.png", title: "图" },
      { type: "image", path: "qr.png" },
    ]);
    expect(r.spec?.items).toEqual([
      { type: "image", path: "~/Desktop/shot.PNG" },
      { type: "file", path: "/tmp/report.pdf" },
      { type: "link", url: "https://example.com/a.png", title: "图" },
    ]);
    expect(r.problems.join("\n")).toContain("not a png, jpg, gif or webp picture; shown as a file");
    expect(r.problems.join("\n")).toContain("a web address, shown as a link");
    expect(r.problems.join("\n")).toContain('"qr.png" is not a full path');
  });

  it("shows at most a few pictures in one fence; the rest as files", () => {
    const many = Array.from({ length: HERD_UI_IMAGES_MAX + 2 }, (_, i) => ({
      type: "image",
      path: `/tmp/${i}.png`,
    }));
    const types = read(many).spec?.items.map((n) => n.type);
    expect(types?.filter((t) => t === "image")).toHaveLength(HERD_UI_IMAGES_MAX);
    expect(types?.filter((t) => t === "file")).toHaveLength(2);
  });

  it("knows picture types by extension", () => {
    expect(herdUiImageType("/a/b.JPG")).toBe("image/jpeg");
    expect(herdUiImageType("/a/b.webp")).toBe("image/webp");
    expect(herdUiImageType("/a/b.svg")).toBeUndefined();
    expect(herdUiImageType("/a/png")).toBeUndefined();
  });
});
