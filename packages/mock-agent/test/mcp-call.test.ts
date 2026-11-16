import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callTool } from "../src/mcp-call.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function makeMcpServerScript(dir: string): string {
  const script = join(dir, "mcp.mjs");
  writeFileSync(
    script,
    [
      'let rest = "";',
      'process.stdin.on("data", (c) => {',
      '  rest += c.toString("utf8");',
      '  let nl = rest.indexOf("\\n");',
      "  while (nl >= 0) {",
      "    const line = rest.slice(0, nl).trim();",
      "    rest = rest.slice(nl + 1);",
      '    nl = rest.indexOf("\\n");',
      "    if (!line) continue;",
      "    const m = JSON.parse(line);",
      '    if (m.method === "initialize") {',
      '      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } }) + "\\n");',
      '    } else if (m.method === "tools/call") {',
      '      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "echo:" + (m.params?.arguments?.msg ?? "") }] } }) + "\\n");',
      "    }",
      "  }",
      "});",
    ].join("\n"),
  );
  return script;
}

describe("callTool", () => {
  it("calls a stdio MCP tool and returns its text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mock-mcp-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const script = makeMcpServerScript(dir);
    const out = await callTool(
      { name: "test", command: process.execPath, args: [script], env: [] },
      "echo",
      { msg: "hello" },
    );
    expect(out).toBe("echo:hello");
  });

  it.skipIf(process.platform !== "win32")(
    "calls a .cmd stdio MCP server with spaces on Windows",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mock-mcp-cmd-"));
      cleanups.push(() => rmSync(root, { recursive: true, force: true }));
      const dir = join(root, "With Spaces");
      mkdirSync(dir, { recursive: true });
      const script = makeMcpServerScript(dir);
      const cmd = join(dir, "mcp wrapper.cmd");
      writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
      const out = await callTool({ name: "test", command: cmd, args: [], env: [] }, "echo", {
        msg: "win",
      });
      expect(out).toBe("echo:win");
    },
  );
});
