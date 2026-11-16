import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitBranch, runGh } from "../src/github-watch.ts";

describe("github-watch platform helpers", () => {
  it("reads the current git branch name", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-git-branch-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "feat/win-check"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
      writeFileSync(join(dir, "README.md"), "hi\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
      expect(gitBranch(dir)).toBe("feat/win-check");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it.runIf(process.platform === "win32")(
    "runs gh.cmd shims on Windows via commandLine",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "agentherd-gh-cmd-"));
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "gh.cmd"), "@echo off\r\necho %~1-%~2\r\n");
        const gh = runGh({ ...process.env, PATH: `${dir};${process.env.PATH ?? ""}` });
        const out = await gh(["pr", "view"]);
        expect(out.trim()).toBe("pr-view");
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      }
    },
  );
});
