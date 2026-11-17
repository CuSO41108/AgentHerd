// What the desktop pet looks like and says (ADR 0070). No model calls: its mood follows what the
// host reports, and its own lines are a few fixed ones. Pure functions, so they are easy to test.

import type { PetLine, PetView } from "@agentherd/host/api";

/** Order of the six frames in a figure strip. */
export const MOODS = ["resting", "working", "waiting", "celebrate", "error", "sleeping"] as const;
export type Mood = (typeof MOODS)[number];

/** How long a finished or failed task shows on the pet, and a new line stays in the bubble. */
export const FLASH_MS = 6_000;
/** Nothing new and nothing running for this long: the pet dozes off. */
export const SLEEP_AFTER_MS = 2 * 60_000;
/** Longest text in the bubble; the rest is in Feishu and the app. */
export const BUBBLE_MAX = 90;

export interface MoodInput {
  view: PetView;
  /** Tasks queued or working. */
  working: number;
  /** A finished or failed task shows until this time. */
  flash?: { mood: "celebrate" | "error"; until: number };
  /** Last time anything happened (a line, a task change, the owner touching the pet). */
  lastActive: number;
  now: number;
  /** The app reaches the host. */
  online: boolean;
}

export function moodOf(i: MoodInput): Mood {
  if (i.view.pending.length > 0) return "waiting";
  if (i.flash !== undefined && i.flash.until > i.now) return i.flash.mood;
  if (i.working > 0) return "working";
  if (!i.online || i.now - i.lastActive >= SLEEP_AFTER_MS) return "sleeping";
  return "resting";
}

/** The mood a new line flashes, if any: a finished task cheers, a failure looks worried. */
export function flashOf(line: PetLine): "celebrate" | "error" | undefined {
  if (line.kind === "error") return "error";
  if (line.kind !== "report") return undefined;
  return line.result === "done" ? "celebrate" : "error";
}

const LINES: Record<Mood, readonly string[]> = {
  resting: ["我在呢，有事叫我。", "点我就能跟主管说话。"],
  working: ["开工啦！", "正在一点点搞定…", "让我琢磨一下…"],
  waiting: ["有件事要你点头。"],
  celebrate: ["搞定啦！", "又完成一件，开心！"],
  error: ["出了点状况，去看看吧。", "这次没成，要再试试吗？"],
  sleeping: ["我先眯一会儿…"],
};

/** A fixed line for a mood, not the same as the one before if the mood has more than one. */
export function cannedLine(mood: Mood, previous?: string): string {
  const lines = LINES[mood];
  const at = previous === undefined ? -1 : lines.indexOf(previous);
  return lines[(at + 1) % lines.length] ?? lines[0] ?? "";
}

export function cut(text: string, max = BUBBLE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** What the bubble says for a line AgentHerd sent. */
export function lineText(line: PetLine): string {
  if (line.kind === "report" && line.task !== undefined) {
    const head = line.result === "done" ? "做完了" : line.result === "stopped" ? "停了" : "没做成";
    return cut(`「${line.task}」${head}：${line.text}`);
  }
  if (line.task !== undefined && line.kind !== "say") return cut(`「${line.task}」${line.text}`);
  return cut(line.text);
}
