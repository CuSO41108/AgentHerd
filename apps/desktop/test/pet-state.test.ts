import type { PetView } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import {
  badgeOf,
  CHAT_DEFAULT,
  CHAT_MIN,
  clockOf,
  cut,
  dragChat,
  FLASH_MS,
  fitChat,
  flashOf,
  historyHead,
  moodOf,
  newestScroll,
  newLine,
  readChatSize,
  SLEEP_AFTER_MS,
  trailingLine,
} from "../src/renderer/src/pet/pet-state";
import { ANIMATIONS, ATLAS, frameAt, HELLO_MS } from "../src/renderer/src/pet/sprite";

const IDLE: PetView = { connected: true, pending: [] };
const NOW = 1_000_000;

describe("pet mood (ADR 0070)", () => {
  const base = { view: IDLE, working: 0, lastActive: NOW, now: NOW, online: true };

  it("waits while something waits for the owner, before anything else", () => {
    const view: PetView = {
      connected: true,
      pending: [{ target: "i1", title: "rm -rf ./*", body: "", options: [] }],
    };
    expect(
      moodOf({ ...base, view, working: 2, flash: { mood: "celebrate", until: NOW + 1 } }),
    ).toBe("waiting");
  });

  it("cheers or worries for a while after a task ends, then works or rests", () => {
    expect(moodOf({ ...base, flash: { mood: "celebrate", until: NOW + 1 } })).toBe("celebrate");
    expect(moodOf({ ...base, working: 1, flash: { mood: "error", until: NOW + 1 } })).toBe("error");
    expect(moodOf({ ...base, working: 1, flash: { mood: "error", until: NOW } })).toBe("working");
    expect(moodOf(base)).toBe("resting");
  });

  it("dozes off when nothing happens, and while the host is away", () => {
    expect(moodOf({ ...base, lastActive: NOW - SLEEP_AFTER_MS })).toBe("sleeping");
    expect(moodOf({ ...base, online: false })).toBe("sleeping");
    expect(moodOf({ ...base, working: 1, lastActive: NOW - SLEEP_AFTER_MS })).toBe("working");
  });

  it("flashes on reports and errors only", () => {
    const line = { id: 1, at: "", text: "x" };
    expect(flashOf({ ...line, kind: "report", result: "done" })).toBe("celebrate");
    expect(flashOf({ ...line, kind: "report", result: "failed" })).toBe("error");
    expect(flashOf({ ...line, kind: "error" })).toBe("error");
    expect(flashOf({ ...line, kind: "say" })).toBeUndefined();
    expect(FLASH_MS).toBeGreaterThan(0);
  });
});

describe("new lines open the conversation (ADR 0070)", () => {
  const at = "2026-11-18T03:44:18Z";

  it("takes the first look as history, then opens for every newer line", () => {
    const line = { id: 5, at, kind: "say" as const, text: "好" };
    expect(newLine(undefined, line)).toBe(false);
    expect(newLine(5, line)).toBe(false);
    expect(newLine(4, line)).toBe(true);
    expect(newLine(4, undefined)).toBe(false);
  });

  it("shows the latest line after the conversation when the conversation lacks it", () => {
    const history = [{ id: 1, at: "2026-11-18T03:40:00Z", kind: "say" as const, text: "在查了" }];
    const progress = { id: 9, at, kind: "task" as const, task: "搜面馆", text: "启动中" };
    expect(trailingLine(history, progress)).toBe(progress);
    // Already the newest message of the conversation, spaces aside.
    expect(trailingLine(history, { ...progress, text: "在查 了" })).toBeUndefined();
    // Older than the conversation's newest message, or a card of its own.
    expect(trailingLine(history, { ...progress, at: "2026-11-18T03:00:00Z" })).toBeUndefined();
    expect(trailingLine(history, { ...progress, kind: "ask" })).toBeUndefined();
    expect(trailingLine([], progress)).toBe(progress);
    expect(trailingLine(history, undefined)).toBeUndefined();
  });

  it("counts on the folded dot what waits or came meanwhile", () => {
    expect(badgeOf(0, 0)).toBe(0);
    expect(badgeOf(2, 1)).toBe(2);
    expect(badgeOf(0, 3)).toBe(3);
  });

  it("cuts a task name or title to one line", () => {
    expect(cut("修\n登录", 10)).toBe("修 登录");
    const long = cut("字".repeat(200), 30);
    expect(long).toHaveLength(30);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("pet frames", () => {
  it("plays each clip with its frame times, after the rest", () => {
    const resting = ANIMATIONS.resting;
    expect(frameAt(resting, 0)).toEqual({ column: 0, next: 2_400 });
    expect(frameAt(resting, 2_400)).toEqual({ column: 0, next: 280 });
    expect(frameAt(resting, 2_400 + 280 + 50)).toEqual({ column: 1, next: 60 });
    // the next round starts with the rest again
    expect(frameAt(resting, 2_400 + 1_100).column).toBe(0);
  });

  it("loops busy clips, stops a failure on its last frame, keeps sleep still", () => {
    expect(frameAt(ANIMATIONS.working, 820)).toEqual({ column: 0, next: 120 });
    expect(frameAt(ANIMATIONS.error, 10_000)).toEqual({
      column: 7,
      next: Number.POSITIVE_INFINITY,
    });
    expect(frameAt(ANIMATIONS.sleeping, 5_000)).toEqual({
      column: 0,
      next: Number.POSITIVE_INFINITY,
    });
  });

  it("gives every clip its own row inside the atlas", () => {
    const rows = Object.values(ANIMATIONS).map((a) => a.row);
    expect(new Set(rows).size).toBe(rows.length);
    for (const a of Object.values(ANIMATIONS)) {
      expect(a.row).toBeLessThan(ATLAS.rows);
      expect(a.durations.length).toBeLessThanOrEqual(ATLAS.columns);
    }
    expect(HELLO_MS).toBe(700);
  });
});

describe("the conversation (ADR 0070)", () => {
  it("heads a line with its task and how it ended", () => {
    const at = "2026-11-17T12:00:00Z";
    expect(historyHead({ id: 1, at, kind: "owner", text: "搜面馆" })).toBeUndefined();
    expect(historyHead({ id: 2, at, kind: "say", text: "好" })).toBeUndefined();
    expect(historyHead({ id: 3, at, kind: "task", text: "搜索中", task: "面馆" })).toBe("「面馆」");
    expect(
      historyHead({ id: 4, at, kind: "report", text: "找到了", task: "面馆", result: "done" }),
    ).toBe("「面馆」做完了");
    expect(
      historyHead({ id: 5, at, kind: "report", text: "没找到", task: "面馆", result: "failed" }),
    ).toBe("「面馆」没做成");
  });

  it("shows the time, with the date for an earlier day", () => {
    const now = new Date(2026, 10, 17, 23, 0);
    expect(clockOf(new Date(2026, 10, 17, 9, 5).toISOString(), now)).toBe("09:05");
    expect(clockOf(new Date(2026, 10, 16, 21, 30).toISOString(), now)).toBe("11-16 21:30");
    expect(clockOf("not a date", now)).toBe("");
  });
});

describe("sizing the conversation (ADR 0070)", () => {
  const room = { width: 900, list: 700 };

  it("grows up and to the left from the figure: dragging left or up makes it bigger", () => {
    const start = { width: 360, list: 420 };
    expect(dragChat(start, "corner", -100, -80, room)).toEqual({ width: 460, list: 500 });
    expect(dragChat(start, "left", -100, -80, room)).toEqual({ width: 460, list: 420 });
    expect(dragChat(start, "top", -100, -80, room)).toEqual({ width: 360, list: 500 });
    expect(dragChat(start, "corner", 30, 20, room)).toEqual({ width: 330, list: 400 });
  });

  it("stays between the minimum and what fits on the screen", () => {
    const start = { width: 360, list: 420 };
    expect(dragChat(start, "corner", 500, 500, room)).toEqual(CHAT_MIN);
    expect(dragChat(start, "corner", -2000, -2000, room)).toEqual(room);
    // A small screen wins over the minimum: the pet never leaves the screen.
    expect(fitChat(CHAT_DEFAULT, { width: 250, list: 200 })).toEqual({ width: 250, list: 200 });
  });

  it("keeps the owner's size, and falls back to the default", () => {
    expect(readChatSize(null)).toEqual(CHAT_DEFAULT);
    expect(readChatSize("{broken")).toEqual(CHAT_DEFAULT);
    expect(readChatSize('{"width":"wide"}')).toEqual(CHAT_DEFAULT);
    expect(readChatSize('{"width":520,"list":610}')).toEqual({ width: 520, list: 610 });
    expect(readChatSize('{"width":10,"list":10}')).toEqual(CHAT_MIN);
  });

  it("opens a long newest message at its first line, a short one at the bottom", () => {
    // newest message starts at 3247 in a list that scrolls to 3448: show its start
    expect(newestScroll(3247, 3448)).toBe(3247);
    // newest message starts below the last screenful: just the bottom
    expect(newestScroll(900, 640)).toBe(640);
    expect(newestScroll(-4, 0)).toBe(0);
  });
});
