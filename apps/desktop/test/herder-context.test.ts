import { describe, expect, it } from "vitest";
import { sampleHerderContext } from "../src/renderer/src/dev-fixtures.ts";
import {
  CONTEXT_PARTS,
  formatTokens,
  itemsOf,
  PART_LABELS,
  partsBySize,
  percent,
  timeOf,
} from "../src/renderer/src/herder-context.ts";

describe("the 上下文 tab (ADR 0093)", () => {
  it("names every part the host measures", () => {
    expect([...CONTEXT_PARTS].sort()).toEqual([
      "folds",
      "herder",
      "memory",
      "owner",
      "results",
      "system",
      "tools",
    ]);
    for (const p of CONTEXT_PARTS) expect(PART_LABELS[p]).not.toBe("");
  });

  it("writes token counts and shares short", () => {
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(19_400)).toBe("19.4k");
    expect(formatTokens(128_000)).toBe("128k");
    expect(formatTokens(1_480_000)).toBe("1.48M");
    expect(percent(0, 0)).toBe("0%");
    expect(percent(57, 128)).toBe("45%");
    expect(percent(9, 1000)).toBe("0.9%");
    expect(percent(1, 100_000)).toBe("<0.1%");
  });

  it("lists parts and items largest first", () => {
    const view = sampleHerderContext();
    const snapshot = view.snapshot;
    if (snapshot === undefined) throw new Error("no snapshot");
    const order = partsBySize(snapshot.parts);
    expect(order[0]).toBe("results");
    expect(
      order.every((p, i) => i === 0 || snapshot.parts[order[i - 1] ?? p] >= snapshot.parts[p]),
    ).toBe(true);
    expect(itemsOf(snapshot, "tools").map((i) => i.label)).toEqual([
      "session_start",
      "web_search",
      "memory",
    ]);
  });

  it("shows the time alone today and the date before", () => {
    const now = new Date(2026, 10, 21, 15, 0);
    expect(timeOf(new Date(2026, 10, 21, 9, 5).toISOString(), now)).toBe("09:05");
    expect(timeOf(new Date(2026, 10, 19, 23, 40).toISOString(), now)).toBe("11-19 23:40");
  });
});
