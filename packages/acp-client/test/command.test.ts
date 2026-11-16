import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cmdVerbatimLine,
  commandLine,
  killTree,
  npmShimTarget,
  quoteCmdArg,
} from "../src/command.ts";

// What npm's cmd-shim writes for a global CLI.
const NPM_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
].join("\r\n");

// What pnpm writes for a package bin shim on Windows.
const PNPM_SHIM = [
  "@SETLOCAL",
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\..\\@earendil-works\\pi-ai\\dist\\cli.js" %*',
  ") ELSE (",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  '  node  "%~dp0\\..\\@earendil-works\\pi-ai\\dist\\cli.js" %*',
  ")",
].join("\r\n");

const PNPM_NODE_ONLY_SHIM = ["@SETLOCAL", 'node  "%~dp0\\..\\pkg\\dist\\cli.mjs" %*'].join("\r\n");

const PNPM_TS_SHIM = [
  "@SETLOCAL",
  '  "%~dp0\\node.exe"  "%~dp0\\..\\@agentherd\\host\\bin\\host.ts" %*',
].join("\r\n");

describe("npmShimTarget", () => {
  it("finds the script an npm shim runs", () => {
    expect(npmShimTarget("C:\\nodejs\\dsh.cmd", NPM_SHIM)).toBe(
      "C:\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js",
    );
  });
  it("finds the script a pnpm shim runs", () => {
    expect(npmShimTarget("C:\\repo\\node_modules\\.bin\\pi-ai.CMD", PNPM_SHIM)).toBe(
      "C:\\repo\\node_modules\\@earendil-works\\pi-ai\\dist\\cli.js",
    );
    expect(npmShimTarget("C:\\bin\\tool.cmd", PNPM_NODE_ONLY_SHIM)).toBe("C:\\pkg\\dist\\cli.mjs");
    expect(npmShimTarget("C:\\repo\\node_modules\\.bin\\agentherd-host.CMD", PNPM_TS_SHIM)).toBe(
      "C:\\repo\\node_modules\\@agentherd\\host\\bin\\host.ts",
    );
  });
  it("ignores other batch files", () => {
    expect(npmShimTarget("C:\\x\\dsh.cmd", '@echo off\r\n"%~dp0app.exe" %*')).toBeUndefined();
    expect(
      npmShimTarget("C:\\x\\dsh.cmd", '@echo off\r\nnode "%~dp0\\app.exe" %*'),
    ).toBeUndefined();
  });
});

describe("commandLine", () => {
  const win = { platform: "win32" as const, node: "C:\\node.exe", comspec: "cmd.exe" };

  it("leaves commands alone outside Windows", () => {
    expect(commandLine("/bin/dsh.cmd", ["acp"], { platform: "darwin" })).toEqual({
      command: "/bin/dsh.cmd",
      args: ["acp"],
      env: {},
    });
  });
  it("leaves executables alone on Windows", () => {
    expect(commandLine("C:\\pi\\pi.exe", ["--mode", "rpc"], win).command).toBe("C:\\pi\\pi.exe");
  });
  it("runs an npm or pnpm shim's script with Node", () => {
    expect(
      commandLine("C:\\nodejs\\dsh.cmd", ["acp"], { ...win, readText: () => NPM_SHIM }),
    ).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js", "acp"],
      env: {},
    });
    expect(
      commandLine("C:\\repo\\.bin\\pi-ai.CMD", ["--help"], { ...win, readText: () => PNPM_SHIM }),
    ).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\repo\\@earendil-works\\pi-ai\\dist\\cli.js", "--help"],
      env: {},
    });
  });
  it("runs any other batch file through cmd.exe /d /s /c with verbatim quoting", () => {
    const cmd = "C:\\Program Files\\DSH\\dsh.cmd";
    const args = ["acp", "--patch", "C:\\Users\\Alice Smith\\dsh-model.json"];
    const line = commandLine(cmd, args, {
      ...win,
      readText: () => "@echo off",
    });
    expect(line).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", cmdVerbatimLine(cmd, args)],
      env: {},
      windowsVerbatimArguments: true,
    });
    expect(quoteCmdArg("%OS%&x")).toBe('^"^%OS^%^&x^"');
  });
  it("still uses cmd.exe when the batch file cannot be read", () => {
    const line = commandLine("C:\\x\\a.BAT", [], {
      ...win,
      readText: () => {
        throw new Error("EACCES");
      },
    });
    expect(line.command).toBe("cmd.exe");
    expect(line.windowsVerbatimArguments).toBe(true);
  });

  it.skipIf(process.platform !== "win32")(
    "passes spaces and metacharacters intact through cmd.exe when both command and args have spaces",
    () => {
      const root = mkdtempSync(join(tmpdir(), "cmd-spaces-"));
      try {
        const dir = join(root, "Program Files", "DSH App");
        mkdirSync(dir, { recursive: true });
        const script = join(dir, "echo.js");
        const cmd = join(dir, "run dsh.cmd");
        writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)));\n");
        writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "%~dp0echo.js" %*\r\n`);
        const args = ["--patch", "C:\\Users\\Alice Smith\\dsh model.json", "%OS%&x", ""];
        const line = commandLine(cmd, args);
        const res = spawnSync(line.command, line.args, {
          encoding: "utf8",
          windowsHide: true,
          ...(line.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        });
        expect(res.status).toBe(0);
        expect(JSON.parse(res.stdout.trim())).toEqual(args);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("killTree", () => {
  const child = (pid: number | undefined) => {
    const signals: string[] = [];
    return { pid, signals, kill: (s?: NodeJS.Signals) => signals.push(s ?? "") > 0 };
  };

  it("ends the whole process tree on Windows", () => {
    const c = child(42);
    const runs: string[][] = [];
    killTree(c, "SIGTERM", { platform: "win32", run: (cmd, args) => runs.push([cmd, ...args]) });
    expect(runs).toEqual([["taskkill", "/pid", "42", "/t", "/f"]]);
    expect(c.signals).toEqual([]);
  });
  it("sends the signal elsewhere", () => {
    const c = child(42);
    killTree(c, "SIGTERM", { platform: "linux", run: () => expect.unreachable() });
    expect(c.signals).toEqual(["SIGTERM"]);
  });
  it("falls back to kill when the process never started", () => {
    const c = child(undefined);
    killTree(c, "SIGKILL", { platform: "win32", run: () => expect.unreachable() });
    expect(c.signals).toEqual(["SIGKILL"]);
  });
});
