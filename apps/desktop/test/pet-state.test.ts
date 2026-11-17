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
