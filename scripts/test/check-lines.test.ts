import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { countLines, isChecked, longFiles, MAX_LINES } from "../check-lines.ts";
import { isEntry } from "../entry.ts";

describe("check-lines", () => {
  it("counts lines the way an editor shows them", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
    expect(countLines("a\r\nb\r\n")).toBe(2);
  });

  it("checks source files and skips the forked Pi loop and other files", () => {
    expect(isChecked("packages/core/src/herd.ts")).toBe(true);
    expect(isChecked("apps/desktop/src/renderer/src/App.tsx")).toBe(true);
    expect(isChecked("apps/desktop/src/renderer/src/tokens.css")).toBe(true);
    expect(isChecked("packages/herder-loop/src/agent.ts")).toBe(false);
    expect(isChecked("packages/herder-loop/test/agent.test.ts")).toBe(false);
    expect(isChecked("docs/spec/04-herder.md")).toBe(false);
    expect(isChecked("pnpm-lock.yaml")).toBe(false);
  });

  it("reports files over the limit, longest first", () => {
    const text = (n: number) => "x\n".repeat(n);
    expect(
      longFiles([
        { path: "a.ts", text: text(MAX_LINES) },
        { path: "b.ts", text: text(MAX_LINES + 1) },
        { path: "c.tsx", text: text(MAX_LINES + 50) },
        { path: "packages/herder-loop/src/big.ts", text: text(MAX_LINES * 3) },
        { path: "notes.md", text: text(2000) },
      ]),
    ).toEqual([
      { path: "c.tsx", lines: MAX_LINES + 50 },
      { path: "b.ts", lines: MAX_LINES + 1 },
    ]);
  });
});

describe("isEntry", () => {
  it("matches case-insensitively on win32 and case-sensitively elsewhere", () => {
    const self = fileURLToPath(import.meta.url);
    expect(isEntry(undefined, import.meta.url)).toBe(false);
    expect(isEntry(self, import.meta.url)).toBe(true);
    expect(isEntry(self.toLowerCase(), import.meta.url, "win32")).toBe(true);
    const missing = join(dirname(self), "NonExistentScript.ts");
    const missingUrl = pathToFileURL(missing).href;
    expect(isEntry(missing.toLowerCase(), missingUrl, "win32")).toBe(true);
    expect(isEntry(missing.toLowerCase(), missingUrl, "linux")).toBe(false);
  });
});
