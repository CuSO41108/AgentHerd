import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_CONFIG_ENV, withClaudeHome } from "../src/claude-home.ts";

describe("Claude Code home (ADR 0066)", () => {
  it("points CLAUDE_CONFIG_DIR at settings that ask before every edit and command", () => {
    const home = mkdtempSync(join(tmpdir(), "ah-claude-"));
    const env = withClaudeHome(home, { ANTHROPIC_API_KEY: "k" });
    const dir = env[CLAUDE_CONFIG_ENV] ?? "";
    expect(dir).toBe(join(home, "run", "claude"));
    expect(env.ANTHROPIC_API_KEY).toBe("k");
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(settings.permissions.defaultMode).toBe("default");
    expect(settings.disableAutoMode).toBe("disable");
    // Holds no key.
    expect(readFileSync(join(dir, "settings.json"), "utf8")).not.toContain('k"');
    expect(withClaudeHome(home, {})[CLAUDE_CONFIG_ENV]).toBe(dir);
  });
});
