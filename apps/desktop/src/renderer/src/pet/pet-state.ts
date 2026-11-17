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

/** Two clicks on the figure within this long are a double click. */
export const DOUBLE_CLICK_MS = 320;

/**
 * What a click on the figure does. One click opens the small bubble at once, or closes the open
 * one unless a second click follows; a double click switches between the bubble and the
 * conversation.
 */
export function clickPlan(open: boolean, double: boolean): "open" | "close-later" | "switch" {
  if (double) return "switch";
  return open ? "close-later" : "open";
}

/** The small line above a message of the conversation: which task, and how it ended. */
export function historyHead(line: PetLine): string | undefined {
  if (line.kind === "owner" || line.task === undefined) return undefined;
  if (line.kind === "report") {
    const head = line.result === "done" ? "做完了" : line.result === "stopped" ? "停了" : "没做成";
    return `「${line.task}」${head}`;
  }
  return `「${line.task}」`;
}

/** 14:05 for today, 11-16 14:05 for an earlier day. */
export function clockOf(at: string, now = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString()
    ? time
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/** Size of the conversation: the panel's width and the height of its messages. */
export interface ChatSize {
  width: number;
  list: number;
}

export const CHAT_DEFAULT: ChatSize = { width: 360, list: 420 };
export const CHAT_MIN: ChatSize = { width: 280, list: 240 };

/** Which edges a grip moves: the panel grows from the figure's corner up and to the left. */
export type Grip = "left" | "top" | "corner";

/** The size within the minimum and the room on the screen (the room wins when it is smaller). */
export function fitChat(size: ChatSize, room: ChatSize): ChatSize {
  return {
    width: Math.round(Math.min(room.width, Math.max(CHAT_MIN.width, size.width))),
    list: Math.round(Math.min(room.list, Math.max(CHAT_MIN.list, size.list))),
  };
}

/** The size after dragging a grip by (dx, dy) screen pixels from where it started. */
export function dragChat(
  start: ChatSize,
  grip: Grip,
  dx: number,
  dy: number,
  room: ChatSize,
): ChatSize {
  return fitChat(
    {
      width: grip === "top" ? start.width : start.width - dx,
      list: grip === "left" ? start.list : start.list - dy,
    },
    room,
  );
}

/** A saved size, or the default when there is none or it is broken. */
export function readChatSize(saved: string | null): ChatSize {
  if (saved === null) return CHAT_DEFAULT;
  try {
    const v = JSON.parse(saved) as Partial<ChatSize>;
    if (typeof v.width === "number" && typeof v.list === "number")
      return fitChat({ width: v.width, list: v.list }, { width: Infinity, list: Infinity });
  } catch {
    // broken: the default
  }
  return CHAT_DEFAULT;
}

/**
 * Where the conversation scrolls to: the start of its newest message, or the bottom when that
 * message fits, so a long answer is read from its first line.
 */
export function newestScroll(newestTop: number, maxScroll: number): number {
  return Math.max(0, Math.min(maxScroll, newestTop));
}
