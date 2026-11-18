// Generated UI (ADR 0074): the Herder puts a ```herd-ui JSON fence in a reply; each channel draws
// it its own way (the pet as components, Feishu as card elements, anywhere else as text). This
// module reads such fences forgivingly — it repairs what a small model tends to get wrong, drops
// what it cannot use, and says why — so one broken part never takes the whole reply with it.

/** The fence's language tag. */
export const HERD_UI_FENCE = "herd-ui";
/** Targets of a reply's choices start with this; the action is the answer's number. */
export const HERD_UI_TARGET = "ui:";
/** At most this many components in one fence. */
export const HERD_UI_MAX_NODES = 30;
/** Longest text in one field; longer is cut. */
export const HERD_UI_TEXT_MAX = 2000;
/** A table keeps at most this many columns and rows. */
export const HERD_UI_TABLE_COLUMNS = 8;
export const HERD_UI_TABLE_ROWS = 50;
/** Lists, pairs, stats and steps keep at most this many entries. */
export const HERD_UI_ENTRIES_MAX = 30;
/** A choice offers at most this many answers, each at most this long. */
export const HERD_UI_CHOICES_MAX = 6;
export const HERD_UI_CHOICE_CHARS = 40;

export type HerdUiTone = "info" | "success" | "warning" | "error";
export type HerdUiStepStatus = "done" | "doing" | "todo";

/** The components the Herder can use. Flat: no component holds another. */
export type HerdUiNode =
  | { type: "text"; content: string }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "keyvalue"; pairs: { key: string; value: string }[] }
  | { type: "stats"; items: { label: string; value: string; hint?: string }[] }
  | { type: "steps"; steps: { title: string; desc?: string; status?: HerdUiStepStatus }[] }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "callout"; content: string; tone: HerdUiTone; title?: string }
  | { type: "code"; code: string; lang?: string }
  | { type: "link"; url: string; title: string; desc?: string; meta?: string }
  | { type: "file"; path: string; title?: string; desc?: string }
  | { type: "choices"; options: string[]; question?: string }
  | { type: "divider"; label?: string };

export type HerdUiType = HerdUiNode["type"];

export const HERD_UI_TYPES: readonly HerdUiType[] = [
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
];

export interface HerdUiSpec {
  title?: string;
  items: HerdUiNode[];
}

/** What came of reading one fence. `spec` is undefined when nothing in it could be used. */
export interface HerdUiRead {
  spec?: HerdUiSpec;
  /** What was wrong, repaired or dropped, as short lines for the model ("items[2]: …"). */
  problems: string[];
  /** The JSON itself had to be repaired. */
  repaired: boolean;
}

/** A reply cut into Markdown and fences. */
export type HerdUiSegment =
  | { kind: "markdown"; text: string }
  | { kind: "ui"; spec: HerdUiSpec; problems: string[] }
  | { kind: "broken"; raw: string; problems: string[] };

type Json = unknown;
type Obj = Record<string, Json>;
type Of<T extends HerdUiType> = Extract<HerdUiNode, { type: T }>;

const isObj = (v: Json): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- JSON, forgivingly

/** Parses JSON a model wrote: strict first, then with the usual slips fixed. */
export function parseLooseJson(raw: string): { value?: Json; repaired: boolean } {
  const text = raw.trim();
  try {
    return { value: JSON.parse(text), repaired: false };
  } catch {
    // fall through to repairs
  }
  // Curly quotes are often words in Chinese text, so they are only taken as JSON quotes last.
  for (const curly of [false, true]) {
    const source = curly ? text.replace(/[“”]/g, '"') : text;
    try {
      return {
        value: JSON.parse(closeBrackets(fixOutside(fixStrings(stripComments(source))))),
        repaired: true,
      };
    } catch {
      // next try
    }
  }
  return { repaired: true };
}

/**
 * Outside strings: quotes bare keys, drops trailing commas, and reads Python's True/False/None.
 */
function fixOutside(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (inString) {
      out += c;
      if (c === "\\") {
        out += s[i + 1] ?? "";
        i++;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ",") {
      const next = s.slice(i + 1).match(/^\s*([}\]]|$)/);
      if (next !== null) continue;
      out += c;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const word = s.slice(i).match(/^[A-Za-z_][\w-]*/)?.[0] ?? c;
      const after = s.slice(i + word.length).match(/^\s*:/);
      if (after !== null) out += `"${word}"`;
      else out += { True: "true", False: "false", None: "null" }[word] ?? word;
      i += word.length - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Drops `//` and `/* *\/` comments outside strings. */
function stripComments(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (inString) {
      out += c;
      if (c === "\\") {
        out += s[i + 1] ?? "";
        i++;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 1;
    } else out += c;
  }
  return out;
}

/** Raw newlines and tabs in strings are escaped; a string cut off at the end is closed. */
function fixStrings(straight: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < straight.length; i++) {
    const c = straight[i] as string;
    if (inString) {
      if (c === "\\") {
        out += c + (straight[i + 1] ?? "");
        i++;
        continue;
      }
      if (c === '"') inString = false;
      if (c === "\n") out += "\\n";
      else if (c === "\r") continue;
      else if (c === "\t") out += "\\t";
      else out += c;
      continue;
    }
    if (c === '"') inString = true;
    out += c;
  }
  return inString ? `${out}"` : out;
}

/** Adds the closing brackets a cut-off reply is missing. */
function closeBrackets(s: string): string {
  const open: string[] = [];
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") open.push("}");
    else if (c === "[") open.push("]");
    else if (c === "}" || c === "]") open.pop();
  }
  return s.replace(/,\s*$/, "") + open.reverse().join("");
}

// ---------------------------------------------------------------- reading a spec

const TYPE_ALIASES: Record<string, HerdUiType> = {
  markdown: "text",
  md: "text",
  paragraph: "text",
  heading: "text",
  title: "text",
  kv: "keyvalue",
  "key-value": "keyvalue",
  key_value: "keyvalue",
  keyvalues: "keyvalue",
  properties: "keyvalue",
  facts: "keyvalue",
  stat: "stats",
  metric: "stats",
  metrics: "stats",
  numbers: "stats",
  step: "steps",
  timeline: "steps",
  progress: "steps",
  bullets: "list",
  ul: "list",
  ol: "list",
  alert: "callout",
  note: "callout",
  tip: "callout",
  warning: "callout",
  notice: "callout",
  codeblock: "code",
  pre: "code",
  repo: "link",
  card: "link",
  "link-card": "link",
  linkcard: "link",
  url: "link",
  files: "file",
  attachment: "file",
  buttons: "choices",
  button: "choices",
  options: "choices",
  choice: "choices",
  "quick-replies": "choices",
  replies: "choices",
  select: "choices",
  radio: "choices",
  hr: "divider",
  separator: "divider",
  rule: "divider",
};

const TONE_ALIASES: Record<string, HerdUiTone> = {
  info: "info",
  note: "info",
  tip: "info",
  neutral: "info",
  success: "success",
  ok: "success",
  done: "success",
  good: "success",
  warning: "warning",
  warn: "warning",
  caution: "warning",
  error: "error",
  danger: "error",
  bad: "error",
  fail: "error",
  failed: "error",
};

const STATUS_ALIASES: Record<string, HerdUiStepStatus> = {
  done: "done",
  complete: "done",
  completed: "done",
  finished: "done",
  success: "done",
  doing: "doing",
  active: "doing",
  current: "doing",
  running: "doing",
  "in-progress": "doing",
  in_progress: "doing",
  todo: "todo",
  pending: "todo",
  waiting: "todo",
  next: "todo",
};

/** First field present among the names, as text. */
function field(o: Obj, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = o[n];
    const s = textOf(v);
    if (s !== undefined) return s;
  }
  return undefined;
}

/** A scalar as text; anything else is undefined. */
function textOf(v: Json): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/** Any value as one line of text (a cell of a table, the value of a pair). */
function cellOf(v: Json): string {
  const s = textOf(v);
  if (s !== undefined) return s;
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cellOf).join("、");
  if (isObj(v)) {
    const named = field(v, "text", "label", "title", "name", "value", "content");
    if (named !== undefined) return named;
  }
  return JSON.stringify(v);
}

function clip(s: string, max = HERD_UI_TEXT_MAX): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function arrayOf(o: Obj, ...names: string[]): Json[] | undefined {
  for (const n of names) {
    const v = o[n];
    if (Array.isArray(v)) return v;
  }
  return undefined;
}

/** Reads one fence body. */
export function readHerdUi(raw: string): HerdUiRead {
  const problems: string[] = [];
  const { value, repaired } = parseLooseJson(raw);
  if (repaired && value !== undefined) problems.push("the JSON had to be repaired");
  if (value === undefined) {
    return { problems: ["not valid JSON; write one JSON object"], repaired };
  }
  let title: string | undefined;
  let list: Json[];
  if (Array.isArray(value)) list = value;
  else if (isObj(value)) {
    const items = arrayOf(value, "items", "children", "components", "blocks", "nodes", "body");
    if (items !== undefined) {
      list = items;
      title = field(value, "title");
    } else if (typeof value.type === "string") list = [value];
    else return { problems: ['no "items" list'], repaired };
  } else return { problems: ['write an object {"items": [...]}'], repaired };

  const items: HerdUiNode[] = [];
  list.forEach((entry, i) => {
    if (items.length >= HERD_UI_MAX_NODES) {
      if (i === HERD_UI_MAX_NODES)
        problems.push(`more than ${HERD_UI_MAX_NODES} items; the rest dropped`);
      return;
    }
    const where = `items[${i}]`;
    if (typeof entry === "string") {
      if (entry.trim() !== "") items.push({ type: "text", content: clip(entry) });
      problems.push(`${where}: a bare string, read as text`);
      return;
    }
    if (!isObj(entry)) {
      problems.push(`${where}: not an object; dropped`);
      return;
    }
    const node = readNode(entry, where, problems);
    if (node !== undefined) items.push(node);
  });
  if (items.length === 0) {
    problems.push("nothing usable in it");
    return { problems, repaired };
  }
  const spec: HerdUiSpec =
    title === undefined || title.trim() === "" ? { items } : { title: clip(title, 120), items };
  return { spec, problems, repaired };
}

function readNode(o: Obj, where: string, problems: string[]): HerdUiNode | undefined {
  const rawType = (field(o, "type", "kind", "component") ?? "").trim();
  const lower = rawType.toLowerCase();
  const type: HerdUiType | undefined = (HERD_UI_TYPES as readonly string[]).includes(lower)
    ? (lower as HerdUiType)
    : TYPE_ALIASES[lower];
  if (type === undefined) {
    // An unknown component with words in it still says something.
    const words = field(o, "content", "text", "markdown", "body", "title");
    problems.push(
      `${where}: unknown type "${rawType}"${words === undefined ? "; dropped" : ", shown as text"} (use one of ${HERD_UI_TYPES.join(", ")})`,
    );
    return words === undefined ? undefined : { type: "text", content: clip(words) };
  }
  if (type !== lower) problems.push(`${where}: type "${rawType}" read as "${type}"`);
  const missing = (what: string) => {
    problems.push(`${where} (${type}): missing ${what}; dropped`);
    return undefined;
  };
  switch (type) {
    case "text": {
      let content = field(o, "content", "text", "markdown", "md", "body", "value");
      if (content === undefined && lower === "heading") content = field(o, "title");
      if (content === undefined) {
        const t = field(o, "title");
        if (t !== undefined) content = `**${t}**`;
      }
      if (content === undefined || content.trim() === "") return missing('"content"');
      return { type, content: clip(content) };
    }
    case "table": {
      let columns = arrayOf(o, "columns", "headers", "header", "head", "cols")?.map((c) =>
        clip(cellOf(c), 80),
      );
      const rawRows = arrayOf(o, "rows", "data", "body", "items") ?? [];
      // Rows written as objects take their columns from the keys.
      if (columns === undefined) {
        const first = rawRows.find(isObj);
        if (first !== undefined) columns = Object.keys(first);
      }
      if (columns === undefined || columns.length === 0) return missing('"columns"');
      if (columns.length > HERD_UI_TABLE_COLUMNS) {
        problems.push(
          `${where} (table): more than ${HERD_UI_TABLE_COLUMNS} columns; the rest dropped`,
        );
        columns = columns.slice(0, HERD_UI_TABLE_COLUMNS);
      }
      const keys = columns;
      const rows = rawRows
        .map((r) =>
          Array.isArray(r)
            ? r.slice(0, keys.length).map((c) => clip(cellOf(c), 400))
            : isObj(r)
              ? keys.map((k) => clip(cellOf(r[k]), 400))
              : [clip(cellOf(r), 400)],
        )
        .map((r) => [...r, ...Array(Math.max(0, keys.length - r.length)).fill("")]);
      if (rows.length === 0) return missing('"rows"');
      if (rows.length > HERD_UI_TABLE_ROWS) {
        problems.push(`${where} (table): more than ${HERD_UI_TABLE_ROWS} rows; the rest dropped`);
      }
      return { type, columns, rows: rows.slice(0, HERD_UI_TABLE_ROWS) };
    }
    case "keyvalue": {
      const list = arrayOf(o, "pairs", "items", "fields", "rows", "data", "entries");
      let pairs: { key: string; value: string }[] = [];
      if (list !== undefined) {
        pairs = list.flatMap((p) => {
          if (Array.isArray(p) && p.length >= 2)
            return [{ key: cellOf(p[0]), value: cellOf(p[1]) }];
          if (!isObj(p)) return [];
          const key = field(p, "key", "label", "name", "k", "title", "term");
          if (key === undefined) return [];
          return [{ key, value: cellOf(p.value ?? p.v ?? p.text ?? p.desc ?? p.content ?? "") }];
        });
      } else {
        const map = isObj(o.pairs)
          ? o.pairs
          : isObj(o.data)
            ? o.data
            : isObj(o.items)
              ? o.items
              : undefined;
        if (map !== undefined)
          pairs = Object.entries(map).map(([key, v]) => ({ key, value: cellOf(v) }));
      }
      pairs = pairs
        .filter((p) => p.key.trim() !== "")
        .slice(0, HERD_UI_ENTRIES_MAX)
        .map((p) => ({ key: clip(p.key, 80), value: clip(p.value, 400) }));
      if (pairs.length === 0) return missing('"pairs" [{"key","value"}]');
      return { type, pairs };
    }
    case "stats": {
      const list = arrayOf(o, "items", "stats", "metrics", "data");
      const raw = list ?? (field(o, "value") !== undefined ? [o] : []);
      const items = raw.flatMap((s) => {
        if (!isObj(s)) return [];
        const label = field(s, "label", "name", "title", "key");
        const value = field(s, "value", "number", "count", "text");
        if (label === undefined || value === undefined) return [];
        const hint = field(s, "hint", "desc", "description", "delta", "change", "note", "unit");
        const item: { label: string; value: string; hint?: string } = {
          label: clip(label, 60),
          value: clip(value, 40),
        };
        if (hint !== undefined && hint !== "") item.hint = clip(hint, 80);
        return [item];
      });
      if (items.length === 0) return missing('"items" [{"label","value"}]');
      return { type, items: items.slice(0, 8) };
    }
    case "steps": {
      const list = arrayOf(o, "steps", "items", "events", "entries") ?? [];
      const steps = list.flatMap((s) => {
        if (typeof s === "string") return s.trim() === "" ? [] : [{ title: clip(s, 200) }];
        if (!isObj(s)) return [];
        const title = field(s, "title", "label", "name", "text", "step");
        if (title === undefined) return [];
        const step: { title: string; desc?: string; status?: HerdUiStepStatus } = {
          title: clip(title, 200),
        };
        const desc = field(s, "desc", "description", "detail", "content", "time", "date");
        if (desc !== undefined && desc !== "") step.desc = clip(desc, 400);
        const status = STATUS_ALIASES[(field(s, "status", "state") ?? "").toLowerCase()];
        if (status !== undefined) step.status = status;
        else if (s.done === true) step.status = "done";
        return [step];
      });
      if (steps.length === 0) return missing('"steps" [{"title"}]');
      return { type, steps: steps.slice(0, HERD_UI_ENTRIES_MAX) };
    }
    case "list": {
      const list = arrayOf(o, "items", "list", "entries", "bullets") ?? [];
      const items = list
        .map((x) =>
          isObj(x) ? (field(x, "text", "content", "title", "label") ?? cellOf(x)) : cellOf(x),
        )
        .filter((x) => x.trim() !== "")
        .slice(0, HERD_UI_ENTRIES_MAX)
        .map((x) => clip(x, 600));
      if (items.length === 0) return missing('"items"');
      const ordered =
        o.ordered === true || lower === "ol" || o.style === "ordered" || o.numbered === true;
      return ordered ? { type, items, ordered: true } : { type, items };
    }
    case "callout": {
      const content = field(o, "content", "text", "message", "body", "desc", "description");
      const title = field(o, "title", "heading");
      if (content === undefined && title === undefined) return missing('"content"');
      const named = (
        field(o, "tone", "level", "variant", "severity", "status", "kind") ?? lower
      ).toLowerCase();
      const tone = TONE_ALIASES[named] ?? "info";
      const node: Of<"callout"> = { type, content: clip(content ?? ""), tone };
      if (title !== undefined && content !== undefined) node.title = clip(title, 120);
      else if (content === undefined && title !== undefined) node.content = clip(title);
      return node;
    }
    case "code": {
      const code = field(o, "code", "content", "text", "source", "value");
      if (code === undefined || code.trim() === "") return missing('"code"');
      const lang = field(o, "lang", "language");
      return lang === undefined || lang === ""
        ? { type, code: clip(code, 4000) }
        : { type, code: clip(code, 4000), lang };
    }
    case "link": {
      const url = field(o, "url", "href", "link", "src");
      if (url === undefined) return missing('"url"');
      if (!/^https?:\/\/\S+$/i.test(url.trim())) {
        problems.push(`${where} (link): "${clip(url, 60)}" is not an http(s) link; dropped`);
        return undefined;
      }
      const title = field(o, "title", "name", "label", "text") ?? url.trim();
      const node: Of<"link"> = { type, url: url.trim(), title: clip(title, 120) };
      const desc = field(o, "desc", "description", "summary", "content");
      if (desc !== undefined && desc !== "") node.desc = clip(desc, 300);
      const meta = field(o, "meta", "stars", "info", "subtitle", "tag");
      if (meta !== undefined && meta !== "") node.meta = clip(meta, 120);
      return node;
    }
    case "file": {
      const path = (field(o, "path", "file", "src", "location") ?? "").trim();
      if (path === "") return missing('"path"');
      if (!(path.startsWith("/") || path.startsWith("~/"))) {
        problems.push(
          `${where} (file): "${clip(path, 60)}" is not a full path (/… or ~/…); dropped`,
        );
        return undefined;
      }
      const node: Of<"file"> = { type, path: clip(path, 1000) };
      const title = field(o, "title", "name", "label");
      if (title !== undefined && title !== "") node.title = clip(title, 120);
      const desc = field(o, "desc", "description", "summary");
      if (desc !== undefined && desc !== "") node.desc = clip(desc, 200);
      return node;
    }
    case "choices": {
      const list = arrayOf(o, "options", "choices", "buttons", "items", "answers") ?? [];
      const options = [
        ...new Set(
          list
            .map((x) =>
              isObj(x) ? (field(x, "label", "text", "title", "value", "name") ?? "") : cellOf(x),
            )
            .map((x) => x.trim())
            .filter((x) => x !== ""),
        ),
      ];
      if (options.length === 0) return missing('"options"');
      if (options.length > HERD_UI_CHOICES_MAX) {
        problems.push(
          `${where} (choices): more than ${HERD_UI_CHOICES_MAX} options; the rest dropped`,
        );
      }
      const long = options.filter((x) => x.length > HERD_UI_CHOICE_CHARS);
      if (long.length > 0)
        problems.push(
          `${where} (choices): options longer than ${HERD_UI_CHOICE_CHARS} characters were cut`,
        );
      const node: Of<"choices"> = {
        type,
        options: options.slice(0, HERD_UI_CHOICES_MAX).map((x) => clip(x, HERD_UI_CHOICE_CHARS)),
      };
      const question = field(o, "question", "prompt", "title", "label", "text");
      if (question !== undefined && question.trim() !== "") node.question = clip(question, 300);
      return node;
    }
    case "divider": {
      const label = field(o, "label", "text", "title");
      return label === undefined || label === "" ? { type } : { type, label: clip(label, 60) };
    }
  }
}

// ---------------------------------------------------------------- fences in a reply

/** ```herd-ui (also herd_ui / herdui / herd-ui json), closed or cut off at the end. */
const FENCE =
  /^([ \t]*)(`{3,}|~{3,})[ \t]*herd[-_]?ui\b[^\n]*\n([\s\S]*?)(?:\n[ \t]*\2[ \t]*(?:\n|$)|$(?![\s\S]))/gim;

/** Cuts a reply into Markdown and fences, reading each fence. */
export function splitHerdUi(text: string): HerdUiSegment[] {
  const out: HerdUiSegment[] = [];
  let last = 0;
  FENCE.lastIndex = 0;
  for (let m = FENCE.exec(text); m !== null; m = FENCE.exec(text)) {
    const before = text.slice(last, m.index);
    if (before.trim() !== "")
      out.push({ kind: "markdown", text: before.replace(/^\n+|\n+$/g, "") });
    const body = m[3] ?? "";
    const read = readHerdUi(body);
    if (read.spec !== undefined) out.push({ kind: "ui", spec: read.spec, problems: read.problems });
    else out.push({ kind: "broken", raw: body, problems: read.problems });
    last = m.index + m[0].length;
    if (m[0].length === 0) FENCE.lastIndex++;
  }
  const rest = text.slice(last);
  if (rest.trim() !== "") out.push({ kind: "markdown", text: rest.replace(/^\n+|\n+$/g, "") });
  return out;
}

/** Whether a reply has a herd-ui fence at all. */
export function hasHerdUi(text: string): boolean {
  FENCE.lastIndex = 0;
  return FENCE.test(text);
}

/** A spec written back as its fence: what a reply keeps after it was read and repaired. */
export function herdUiFence(spec: HerdUiSpec): string {
  return `\`\`\`${HERD_UI_FENCE}\n${JSON.stringify(spec)}\n\`\`\``;
}

/** What checking a reply's fences found. */
export interface HerdUiCheck {
  /** The reply with every usable fence written back clean and every broken one left out. */
  text: string;
  /** Fences nothing could be read from. */
  broken: number;
  /** Fences read, maybe with repairs. */
  fences: number;
  /** Problems per fence, "fence 1: …", for telling the model. */
  problems: string[];
}

/** Reads every fence of a reply, so what is stored and sent holds only clean fences. */
export function checkHerdUi(text: string): HerdUiCheck {
  if (!hasHerdUi(text)) return { text, broken: 0, fences: 0, problems: [] };
  const parts: string[] = [];
  const problems: string[] = [];
  let broken = 0;
  let fences = 0;
  for (const s of splitHerdUi(text)) {
    if (s.kind === "markdown") {
      parts.push(s.text);
      continue;
    }
    fences++;
    for (const p of s.problems) problems.push(`fence ${fences}: ${p}`);
    if (s.kind === "ui") parts.push(herdUiFence(s.spec));
    else broken++;
  }
  return { text: parts.join("\n\n"), broken, fences, problems };
}

// ---------------------------------------------------------------- as text

/** One component as Markdown, for places that draw no components. */
export function nodeText(node: HerdUiNode): string {
  switch (node.type) {
    case "text":
      return node.content;
    case "table": {
      const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
      return [
        `| ${node.columns.map(cell).join(" | ")} |`,
        `| ${node.columns.map(() => "---").join(" | ")} |`,
        ...node.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
      ].join("\n");
    }
    case "keyvalue":
      return node.pairs.map((p) => `- **${p.key}**：${p.value}`).join("\n");
    case "stats":
      return node.items
        .map((s) => `- **${s.value}** ${s.label}${s.hint === undefined ? "" : `（${s.hint}）`}`)
        .join("\n");
    case "steps":
      return node.steps
        .map((s, i) => {
          const mark = s.status === "done" ? "✅ " : s.status === "doing" ? "⏳ " : "";
          return `${i + 1}. ${mark}${s.title}${s.desc === undefined ? "" : ` — ${s.desc}`}`;
        })
        .join("\n");
    case "list":
      return node.items
        .map((x, i) => (node.ordered === true ? `${i + 1}. ${x}` : `- ${x}`))
        .join("\n");
    case "callout": {
      const icon = { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌" }[node.tone];
      const head = node.title === undefined ? icon : `${icon} **${node.title}**`;
      return `> ${head} ${node.content}`.replace(/\n/g, "\n> ");
    }
    case "code":
      return `\`\`\`${node.lang ?? ""}\n${node.code}\n\`\`\``;
    case "link": {
      const extra = [node.meta, node.desc].filter((x) => x !== undefined).join(" · ");
      return `[${node.title}](${node.url})${extra === "" ? "" : ` — ${extra}`}`;
    }
    case "file":
      return `📄 ${node.title === undefined ? node.path : `${node.title}：${node.path}`}`;
    case "choices":
      return [node.question, ...node.options.map((x) => `- ${x}`)]
        .filter((x) => x !== undefined)
        .join("\n");
    case "divider":
      return node.label === undefined ? "---" : `—— ${node.label} ——`;
  }
}

/** A spec as Markdown. */
export function specText(spec: HerdUiSpec): string {
  const parts = spec.items.map(nodeText);
  return (spec.title === undefined ? parts : [`**${spec.title}**`, ...parts]).join("\n\n");
}

/** A reply with its fences written as Markdown (broken ones left out). */
export function herdUiPlain(text: string): string {
  if (!hasHerdUi(text)) return text;
  return splitHerdUi(text)
    .flatMap((s) => (s.kind === "markdown" ? [s.text] : s.kind === "ui" ? [specText(s.spec)] : []))
    .join("\n\n");
}

/** The answers a reply offers, numbered across all its `choices` in order: action "0", "1", … */
export function herdUiChoices(
  text: string,
): { action: string; label: string; question?: string }[] {
  if (!hasHerdUi(text)) return [];
  const out: { action: string; label: string; question?: string }[] = [];
  for (const s of splitHerdUi(text)) {
    if (s.kind !== "ui") continue;
    for (const node of s.spec.items) {
      if (node.type !== "choices") continue;
      for (const label of node.options) {
        const action = String(out.length);
        out.push(
          node.question === undefined
            ? { action, label }
            : { action, label, question: node.question },
        );
      }
    }
  }
  return out;
}
