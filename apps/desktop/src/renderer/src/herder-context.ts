// Labels, colours and number formats for the 主管 page's 上下文 tab (ADR 0093). Kept apart from
// the page so they can be tested without React.

import type {
  HerderContextPart,
  HerderContextParts,
  HerderContextSnapshot,
} from "@agentherd/host/api";

/** The parts in the order the model reads them. */
export const CONTEXT_PARTS: readonly HerderContextPart[] = [
  "system",
  "memory",
  "tools",
  "folds",
  "owner",
  "herder",
  "results",
];

export const PART_LABELS: Record<HerderContextPart, string> = {
  system: "系统提示词",
  memory: "记忆",
  tools: "工具定义",
  folds: "折叠摘要和提示",
  owner: "你的话",
  herder: "主管的回复",
  results: "工具结果",
};

/** What each part is, in one line, for the legend's tooltip. */
export const PART_HINTS: Record<HerderContextPart, string> = {
  system: "主管的规则、说话风格、折叠规则和连接的账号",
  memory: "每次都带上的记忆：你的画像、关于你、定了的事、主管笔记",
  tools: "主管能调用的每个工具的说明",
  folds: "旧对话折叠后的摘要，和 AgentHerd 加的提醒",
  owner: "你说的话、你的回答，和任务结果之类的事件",
  herder: "主管写的回复和它发出的工具调用",
  results: "工具返回的内容：任务列表、网页、搜索结果……",
};

export const PART_COLORS: Record<HerderContextPart, string> = {
  system: "#6366f1",
  memory: "#a855f7",
  tools: "#f59e0b",
  folds: "#94a3b8",
  owner: "#22c55e",
  herder: "#3b82f6",
  results: "#14b8a6",
};

/** 812 → "812", 19_400 → "19.4k", 1_250_000 → "1.25M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1) : k < 100 ? k.toFixed(1) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(2) : m.toFixed(1)}M`;
}

/** A share as a percent with one decimal under 10 %, none above; "0%" for an empty total. */
export function percent(part: number, total: number): string {
  if (total <= 0) return "0%";
  const p = (part / total) * 100;
  if (p > 0 && p < 0.1) return "<0.1%";
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

/** The parts with tokens, largest first, for the legend. */
export function partsBySize(parts: HerderContextParts): HerderContextPart[] {
  return CONTEXT_PARTS.filter((p) => parts[p] > 0).sort((a, b) => parts[b] - parts[a]);
}

/** The items of one part, largest first. */
export function itemsOf(snapshot: HerderContextSnapshot, part: HerderContextPart) {
  return snapshot.items.filter((i) => i.part === part).sort((a, b) => b.tokens - a.tokens);
}

/** "HH:MM" today, "MM-DD HH:MM" before. */
export function timeOf(at: string, now = new Date()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString()
    ? hm
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
