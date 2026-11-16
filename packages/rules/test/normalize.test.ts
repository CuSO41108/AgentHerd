import { describe, expect, it } from "vitest";
import { commandHead, normalizeCommand } from "../src/normalize.ts";

describe("normalizeCommand", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeCommand("  pnpm   test  ")).toBe("pnpm test");
  });

  it("collapses tabs and newlines", () => {
    expect(normalizeCommand("pnpm\t\t run\nbuild")).toBe("pnpm run build");
  });

  it("strips a single leading env assignment", () => {
    expect(normalizeCommand("FOO=1 pnpm test")).toBe("pnpm test");
  });

  it("strips multiple leading env assignments", () => {
    expect(normalizeCommand("FOO=1 BAR=2 pnpm test")).toBe("pnpm test");
  });

  it("strips a leading env word followed by assignments", () => {
    expect(normalizeCommand("env FOO=1 BAR=2 pnpm test")).toBe("pnpm test");
  });

  it("strips a leading cd prefix", () => {
    expect(normalizeCommand("cd /some/dir && pnpm test")).toBe("pnpm test");
  });

  it("strips repeated cd prefixes", () => {
    expect(normalizeCommand("cd a && cd b && pnpm test")).toBe("pnpm test");
  });

  it("strips mixed env and cd prefixes", () => {
    expect(normalizeCommand("FOO=1 cd dir && BAR=2 pnpm test")).toBe("pnpm test");
  });

  it("strips a double-quoted env value", () => {
    expect(normalizeCommand('FOO="two words" pnpm test')).toBe("pnpm test");
  });

  it("strips a single-quoted env value", () => {
    expect(normalizeCommand("FOO='two words' pnpm test")).toBe("pnpm test");
  });

  it("strips a complex combination of prefixes", () => {
    expect(normalizeCommand("FOO=1 BAR='x y' cd d && env BAZ=3 pnpm test")).toBe("pnpm test");
  });

  it("leaves a plain command unchanged", () => {
    expect(normalizeCommand("pnpm test")).toBe("pnpm test");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeCommand("")).toBe("");
  });

  it("strips Windows cd /d prefixes and CRLF", () => {
    expect(normalizeCommand("cd /d D:\\proj && pnpm test")).toBe("pnpm test");
    expect(normalizeCommand('CD /D "C:\\My Projects\\app" && pnpm test')).toBe("pnpm test");
    expect(normalizeCommand("FOO=1 cd /d C:\\dir && BAR=2 pnpm test")).toBe("pnpm test");
    expect(normalizeCommand("pnpm\r\ntest")).toBe("pnpm test");
  });
});

describe("commandHead", () => {
  it("returns the first two words after normalization", () => {
    expect(commandHead("FOO=1 cd d && pnpm test --watch")).toBe("pnpm test");
    expect(commandHead("cd /d D:\\proj && pnpm test --watch")).toBe("pnpm test");
  });

  it("returns a single word when only one exists", () => {
    expect(commandHead("pnpm")).toBe("pnpm");
  });

  it("returns the first two words of a longer command", () => {
    expect(commandHead("   pnpm   run build  ")).toBe("pnpm run");
  });

  it("returns an empty string for empty input", () => {
    expect(commandHead("")).toBe("");
  });
});
