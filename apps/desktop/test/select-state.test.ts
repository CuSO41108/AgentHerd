import { describe, expect, it } from "vitest";
import {
  filterSelectSections,
  flattenSelectOptions,
  placeSelectMenu,
  type SelectSection,
  stepSelectIndex,
} from "../src/renderer/src/components/select-state";

const SECTIONS: SelectSection[] = [
  { id: "_none", options: [{ value: "", label: "不选", muted: true }] },
  {
    id: "claude-relay",
    label: "个人中转站Claude",
    options: [
      {
        value: '["claude-relay","claude-opus-5-5"]',
        label: "claude-opus-5-5",
        tag: "个人中转站Claude",
        mono: true,
        keywords: "个人中转站Claude claude-relay",
      },
    ],
  },
  {
    id: "gemini-relay",
    label: "个人中转站gemini",
    options: [
      {
        value: '["gemini-relay","gemini-3.8-flash"]',
        label: "gemini-3.8-flash",
        tag: "个人中转站gemini",
        mono: true,
        keywords: "个人中转站gemini gemini-relay",
      },
    ],
  },
];

describe("custom Select state helpers", () => {
  it("flattens sections in order", () => {
    expect(flattenSelectOptions(SECTIONS).map((o) => o.label)).toEqual([
      "不选",
      "claude-opus-5-5",
      "gemini-3.8-flash",
    ]);
  });

  it("filters across section name, option label and keywords using multiple tokens", () => {
    expect(filterSelectSections(SECTIONS, "")).toHaveLength(3);
    const gemini = filterSelectSections(SECTIONS, "gemini flash");
    expect(gemini).toHaveLength(1);
    expect(gemini[0]?.id).toBe("gemini-relay");
    expect(gemini[0]?.options.map((o) => o.label)).toEqual(["gemini-3.8-flash"]);
    expect(filterSelectSections(SECTIONS, "中转站 opus").map((s) => s.id)).toEqual([
      "claude-relay",
    ]);
    expect(filterSelectSections(SECTIONS, "nonexistent")).toEqual([]);
  });

  it("steps through options cleanly with wraparound", () => {
    expect(stepSelectIndex(0, -1, 1)).toBe(-1);
    expect(stepSelectIndex(3, -1, 1)).toBe(0);
    expect(stepSelectIndex(3, -1, -1)).toBe(2);
    expect(stepSelectIndex(3, 2, 1)).toBe(0);
    expect(stepSelectIndex(3, 0, -1)).toBe(2);
  });

  it("places below when room fits and flips upward near the bottom edge", () => {
    expect(
      placeSelectMenu(
        { left: 620, top: 80, right: 908, bottom: 112, width: 288, height: 32 },
        { width: 1000, height: 700 },
        { align: "end", minWidth: 300 },
      ),
    ).toEqual({
      side: "bottom",
      left: 608,
      top: 118,
      width: 300,
      maxHeight: 340,
    });

    expect(
      placeSelectMenu(
        { left: 620, top: 610, right: 908, bottom: 642, width: 288, height: 32 },
        { width: 1000, height: 700 },
        { align: "end", minWidth: 300 },
      ),
    ).toEqual({
      side: "top",
      left: 608,
      bottom: 96,
      width: 300,
      maxHeight: 340,
    });
  });

  it("clamps horizontally when wider than remaining margin on small windows", () => {
    expect(
      placeSelectMenu(
        { left: 4, top: 60, right: 204, bottom: 92, width: 200, height: 32 },
        { width: 260, height: 500 },
        { align: "end", minWidth: 300 },
      ),
    ).toEqual({
      side: "bottom",
      left: 12,
      top: 98,
      width: 236,
      maxHeight: 340,
    });
  });
});
