// Generated UI in Feishu (ADR 0074): the herd-ui fences of a Herder reply become card JSON 2.0
// elements (a table, columns of numbers, a link box, answer buttons, …), and the Markdown around
// them stays Markdown. A fence nothing could be read from is left out, so the owner never sees
// its raw JSON; the words around it still say what the reply says.

import type { View } from "@agentherd/protocol";
import type { HerdUiNode, HerdUiSegment, HerdUiSpec } from "@agentherd/protocol/herd-ui";
import {
  hasHerdUi,
  herdUiChoices,
  herdUiPlain,
  localPicture,
  nodeText,
  replaceMarkdownImages,
  specText,
  splitHerdUi,
} from "@agentherd/protocol/herd-ui";
import {
  answerElement,
  type Element,
  escapeCodeFence,
  escapeMarkdown,
  foldedMarkdown,
  markdown,
} from "./card-parts.ts";
import { readableMath } from "./math.ts";
import type { CardTexts } from "./texts.ts";

type Of<T extends HerdUiNode["type"]> = Extract<HerdUiNode, { type: T }>;

export interface HerdUiCardOptions {
  /** Owner-facing texts of the card's locale. */
  t: CardTexts;
  /** Target of the answers' buttons, e.g. "ui:<uuid>". Without one, answers are a plain list. */
  target?: string | undefined;
  /** The answer the owner picked; then the card shows it and no buttons. */
  chosen?: string | undefined;
  /** Image keys of the reply's pictures, by path, once uploaded (ADR 0075). */
  images?: ReadonlyMap<string, string> | undefined;
}

/** What drawing one reply keeps track of across its fences. */
interface Draw {
  opts: HerdUiCardOptions;
  /** Number of the next answer, counted across all `choices` as `herdUiChoices` does. */
  answer: number;
  /** Index of the next `choices` component. */
  choices: number;
  /** Index of the `choices` that shows the picked answer. */
  answeredAt: number;
  /** Table components drawn so far. */
  tables: number;
}

/**
 * Feishu takes at most five table components in one card (table component docs, JSON 2.0).
 * Later tables are drawn as Markdown tables.
 */
export const HERD_UI_TABLE_MAX = 5;

/** At most this many numbers side by side; more go on the next row. */
const STATS_PER_ROW = 4;

/** Feishu shows at most this many table rows per page. */
const TABLE_PAGE = 10;

const TONE_ICON: Record<Of<"callout">["tone"], string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

const STEP_MARK = { done: "✅", doing: "⏳", todo: "◻️" } as const;

/** The elements of a reply that has herd-ui fences. */
export function herdUiElements(text: string, opts: HerdUiCardOptions): Element[] {
  const segments = splitHerdUi(text);
  const draw: Draw = {
    opts,
    answer: 0,
    choices: 0,
    answeredAt: opts.chosen === undefined ? -1 : answeredAt(segments, opts.chosen),
    tables: 0,
  };
  const out: Element[] = [];
  for (const s of segments) {
    if (s.kind === "markdown") out.push(...foldedMarkdown(s.text, opts.t.showAll));
    else if (s.kind === "ui") out.push(...specElements(s.spec, draw));
    // A broken fence is left out.
  }
  // Feishu needs something in the card; say why it is empty instead of showing JSON.
  if (out.length === 0) out.push(markdown(opts.t.herdUiUnreadable));
  return out;
}

/** The `choices` that offered the picked answer, else the last one. */
function answeredAt(segments: HerdUiSegment[], chosen: string): number {
  let index = -1;
  for (const s of segments) {
    if (s.kind !== "ui") continue;
    for (const node of s.spec.items) {
      if (node.type !== "choices") continue;
      index++;
      if (node.options.includes(chosen)) return index;
    }
  }
  return index;
}

function specElements(spec: HerdUiSpec, draw: Draw): Element[] {
  const out: Element[] = spec.title === undefined ? [] : [markdown(`**${spec.title}**`)];
  for (const node of spec.items) out.push(...nodeElements(node, draw));
  return out;
}

function nodeElements(node: HerdUiNode, draw: Draw): Element[] {
  switch (node.type) {
    case "text":
      return foldedMarkdown(node.content, draw.opts.t.showAll);
    case "table":
      return draw.tables++ < HERD_UI_TABLE_MAX ? [table(node)] : [markdown(nodeText(node))];
    case "keyvalue":
      return [markdown(node.pairs.map((p) => `**${p.key}**：${p.value}`).join("\n"))];
    case "stats":
      return stats(node);
    case "steps":
      return [steps(node)];
    case "list":
      return [
        markdown(
          node.items
            .map((x, i) => (node.ordered === true ? `${i + 1}. ${x}` : `- ${x}`))
            .join("\n"),
        ),
      ];
    case "callout": {
      const icon = TONE_ICON[node.tone];
      const head = node.title === undefined ? icon : `${icon} **${node.title}**`;
      if (node.content === "") return [markdown(head)];
      return [
        markdown(node.title === undefined ? `${head} ${node.content}` : `${head}\n${node.content}`),
      ];
    }
    case "code": {
      const lang = node.lang !== undefined && /^[\w+#.-]+$/.test(node.lang) ? node.lang : "";
      return [markdown(`\`\`\`${lang}\n${escapeCodeFence(node.code)}\n\`\`\``)];
    }
    case "link":
      return [link(node)];
    case "file":
      return [file(node)];
    case "image": {
      const key = draw.opts.images?.get(node.path);
      return key === undefined ? [file(node)] : image(node, key);
    }
    case "choices":
      return choices(node, draw);
    case "divider":
      return node.label === undefined
        ? [{ tag: "hr" }]
        : [markdown(grey(node.label)), { tag: "hr" }];
  }
}

/** Grey text; each line on its own, since a font tag does not reach over a line break. */
function grey(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? line : `<font color='grey'>${line}</font>`))
    .join("\n");
}

/** A Feishu table like the board's; columns are named c0, c1, … and cells take Markdown. */
function table(node: Of<"table">): Element {
  const name = (i: number) => `c${i}`;
  return {
    tag: "table",
    page_size: Math.min(TABLE_PAGE, node.rows.length),
    row_height: "low",
    header_style: {
      text_align: "left",
      text_size: "normal",
      background_style: "grey",
      text_color: "default",
      bold: true,
      lines: 1,
    },
    columns: node.columns.map((c, i) => ({
      name: name(i),
      // An empty name shows no header text for the column.
      display_name: c,
      data_type: "lark_md",
      width: "auto",
    })),
    rows: node.rows.map((row) =>
      Object.fromEntries(node.columns.map((_, i) => [name(i), readableMath(row[i] ?? "")])),
    ),
  };
}

/** Numbers side by side: the value in bold over its grey label and hint. */
function stats(node: Of<"stats">): Element[] {
  const rows: Element[] = [];
  for (let i = 0; i < node.items.length; i += STATS_PER_ROW) {
    rows.push({
      tag: "column_set",
      // On a narrow screen, two to a row instead of four squeezed ones.
      flex_mode: "bisect",
      columns: node.items.slice(i, i + STATS_PER_ROW).map((s) => ({
        tag: "column",
        width: "weighted",
        weight: 1,
        vertical_align: "top",
        elements: [
          markdown(
            [`**${s.value}**`, grey(s.label), ...(s.hint === undefined ? [] : [grey(s.hint)])].join(
              "\n",
            ),
          ),
        ],
      })),
    });
  }
  return rows;
}

/** Numbered steps; when any has a status, each gets a mark and the current one is bold. */
function steps(node: Of<"steps">): Element {
  const marked = node.steps.some((s) => s.status !== undefined);
  const lines = node.steps.map((s, i) => {
    const status = s.status ?? "todo";
    const title = marked && status === "doing" ? `**${s.title}**` : s.title;
    const head = `${marked ? `${STEP_MARK[status]} ` : ""}${i + 1}. ${title}`;
    return s.desc === undefined ? head : `${head}\n${grey(s.desc)}`;
  });
  return markdown(lines.join("\n"));
}

/** A box that opens the link: bold title, grey meta, the description, and the address. */
function link(node: Of<"link">): Element {
  const head =
    node.meta === undefined ? `**${node.title}**` : `**${node.title}**  ${grey(node.meta)}`;
  const lines = [
    head,
    ...(node.desc === undefined ? [] : [node.desc]),
    grey(escapeMarkdown(node.url)),
  ];
  return {
    tag: "interactive_container",
    width: "fill",
    has_border: true,
    border_color: "grey",
    corner_radius: "8px",
    padding: "8px 12px 8px 12px",
    behaviors: [{ type: "open_url", default_url: node.url }],
    elements: [markdown(lines.join("\n"))],
  };
}

/**
 * An uploaded picture (ADR 0075), whole and as wide as the card; a tap opens Feishu's viewer.
 * Its title, when it has one, and its description go under it in grey.
 */
function image(node: Of<"image">, key: string): Element[] {
  const name = node.title ?? baseName(node.path);
  const caption = [node.title, node.desc].filter((x) => x !== undefined && x !== "");
  return [
    {
      tag: "img",
      img_key: key,
      alt: { tag: "plain_text", content: name },
      scale_type: "fit_horizontal",
      corner_radius: "8px",
      preview: true,
    },
    ...(caption.length === 0 ? [] : [markdown(grey(caption.join("\n")))]),
  ];
}

/**
 * Markdown images in a reply as Feishu draws them (ADR 0075): a picture on this computer that was
 * uploaded becomes `![alt](image_key)`, which Feishu's Markdown shows inline; one that was not is
 * named with its path; a picture on the web becomes a link, since Feishu shows only uploaded
 * images. Done on the whole text, block JSON included, before it is drawn.
 */
export function withPictures(text: string, images?: ReadonlyMap<string, string>): string {
  if (!text.includes("![")) return text;
  return replaceMarkdownImages(text, ({ alt, src }) => {
    const path = localPicture(src);
    const key = path === undefined ? undefined : images?.get(path);
    const name = alt === "" ? baseName(src) : alt.replace(/[[\]]/g, "");
    if (key !== undefined) return `![${name}](${key})`;
    if (/^https?:\/\//i.test(src)) return `[🖼️ ${name}](${src})`;
    return `🖼️ ${name}：${src}`;
  });
}

function baseName(path: string): string {
  return (
    path
      .split("/")
      .filter((p) => p !== "")
      .pop() ?? path
  );
}

/**
 * A file on the owner's computer: Feishu cannot open it, so its name and its path as text. A
 * picture that could not be uploaded is shown the same way.
 */
function file(node: Of<"file"> | Of<"image">): Element {
  const name = node.title ?? baseName(node.path);
  const lines = [
    `${node.type === "image" ? "🖼️" : "📄"} **${name}**`,
    grey(escapeMarkdown(node.path)),
    ...(node.desc === undefined ? [] : [node.desc]),
  ];
  return markdown(lines.join("\n"));
}

/**
 * The question, then one button (or box, for a long answer) per answer. The action is the
 * answer's number across the whole reply, as `herdUiChoices` counts it. After the owner picked,
 * the card shows the pick and no buttons; without a target the answers are a plain list.
 */
function choices(node: Of<"choices">, draw: Draw): Element[] {
  const out: Element[] = node.question === undefined ? [] : [markdown(node.question)];
  const first = draw.answer;
  const index = draw.choices;
  draw.answer += node.options.length;
  draw.choices++;
  const { target, chosen, t } = draw.opts;
  if (chosen !== undefined) {
    if (index === draw.answeredAt) out.push(markdown(t.askAnswered(chosen)));
    return out;
  }
  if (target === undefined) {
    out.push(markdown(node.options.map((x) => `- ${x}`).join("\n")));
    return out;
  }
  node.options.forEach((label, i) => {
    out.push(answerElement(target, String(first + i), label));
  });
  return out;
}

/**
 * The view drawn the old way, for when Feishu refuses the card drawn from its fences: the
 * fences written as Markdown, and the answers as the buttons of the old offer path (same
 * target and actions, so a tap means the same). Null when the view has no fences.
 */
export function plainHerdUiView(view: View, t: CardTexts): View | null {
  if (view.kind === "report") {
    return hasHerdUi(view.body) ? { ...view, body: herdUiPlain(view.body) } : null;
  }
  if (view.kind !== "text" || !hasHerdUi(view.text)) return null;
  if (view.chosen !== undefined) {
    return { ...view, text: joinParts([withoutAnswers(view.text), t.askAnswered(view.chosen)]) };
  }
  // Without a target there are no buttons; with options of its own the view has its buttons.
  if (view.target === undefined || view.options !== undefined) {
    return { ...view, text: herdUiPlain(view.text) };
  }
  const options = herdUiChoices(view.text).map(({ action, label }) => ({ action, label }));
  return { ...view, text: withoutAnswers(view.text), options };
}

/** Like `herdUiPlain`, but a `choices` keeps only its question: its answers are buttons. */
function withoutAnswers(text: string): string {
  return joinParts(
    splitHerdUi(text).map((s) => {
      if (s.kind === "markdown") return s.text;
      if (s.kind === "broken") return "";
      const items = s.spec.items.flatMap((n): HerdUiNode[] => {
        if (n.type !== "choices") return [n];
        return n.question === undefined ? [] : [{ type: "text", content: n.question }];
      });
      return specText({ ...s.spec, items });
    }),
  );
}

function joinParts(parts: string[]): string {
  return parts.filter((p) => p.trim() !== "").join("\n\n");
}
