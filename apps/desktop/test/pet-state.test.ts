import type { PetView } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import {
  cannedLine,
  FLASH_MS,
  flashOf,
  lineText,
  moodOf,
  SLEEP_AFTER_MS,
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

describe("pet lines", () => {
  it("does not repeat the line before", () => {
    const first = cannedLine("working");
    expect(cannedLine("working", first)).not.toBe(first);
    expect(cannedLine("sleeping", cannedLine("sleeping"))).toBe("我先眯一会儿…");
  });

  it("names the task and cuts long text", () => {
    expect(
      lineText({ id: 1, at: "", kind: "report", task: "修登录", result: "done", text: "好了" }),
    ).toBe("「修登录」做完了：好了");
    expect(lineText({ id: 1, at: "", kind: "task", task: "修登录", text: "跑测试" })).toBe(
      "「修登录」跑测试",
    );
    const long = lineText({ id: 1, at: "", kind: "say", text: "字".repeat(200) });
    expect(long).toHaveLength(90);
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
