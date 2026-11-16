// A minimal stdio MCP client for the `mcp_call` step: start the server, initialize, call one tool,
// stop. Enough to test the `agentherd` server end to end like a real agent would use it.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";

export interface StdioServer {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

const BATCH = /\.(cmd|bat)$/i;
const NODE_SHIM =
  /(?:^|[\s&|@])(?:"%_prog%"|"%~?dp0%?[\\/]?node\.exe"|node(?:\.exe)?)\s+"%(?:~dp0|dp0%)[\\/]?([^"]+)"/i;
const NON_SCRIPT_TARGET = /\.(?:exe|cmd|bat|com|ps1)$/i;

/** Resolves `.cmd`/`.bat` shims on Windows without adding a dependency on `@agentherd/acp-client`. */
function resolveCommand(
  command: string,
  args: readonly string[],
): {
  command: string;
  args: string[];
  env: Record<string, string>;
  windowsVerbatimArguments?: boolean;
} {
  if (process.platform !== "win32" || !BATCH.test(command)) {
    return { command, args: [...args], env: {} };
  }
  let text = "";
  try {
    text = readFileSync(command, "utf8");
  } catch {
    // Let cmd.exe report unreadable batch files.
  }
  const target = text.match(NODE_SHIM)?.[1];
  if (target !== undefined && !NON_SCRIPT_TARGET.test(target)) {
    const script = win32.join(win32.dirname(command), target);
    const electron = process.versions.electron !== undefined;
    return {
      command: process.execPath,
      args: [script, ...args],
      env: electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
    };
  }
  const comspec = process.env.ComSpec ?? "cmd.exe";
  const quote = (s: string) =>
    `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`.replace(
      /([()!^%"<>&|])/g,
      "^$1",
    );
  const cmd = `"${command.replace(/"/g, "")}"`;
  return {
    command: comspec,
    args: ["/d", "/s", "/c", `"${[cmd, ...args.map(quote)].join(" ")}"`],
    env: {},
    windowsVerbatimArguments: true,
  };
}

/** The tool result's text, or `error: …` when the server answered with an error. */
export function callTool(server: StdioServer, tool: string, args: unknown): Promise<string> {
  const line = resolveCommand(server.command, server.args);
  const env = {
    ...process.env,
    ...line.env,
    ...Object.fromEntries(server.env.map((e) => [e.name, e.value])),
  };
  const child = spawn(line.command, line.args, {
    env,
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
    ...(line.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
  child.stdin.on("error", () => {});
  const send = (msg: unknown) => {
    if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(msg)}\n`);
  };
  return new Promise<string>((resolve, reject) => {
    let rest = "";
    let settled = false;
    const done = (text: string) => {
      if (settled) return;
      settled = true;
      if (!child.stdin.destroyed) child.stdin.end();
      resolve(text);
    };
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on("exit", (code) => done(`error: server exited (${code})`));
    child.stdout.on("data", (chunk: Buffer) => {
      rest += chunk.toString("utf8");
      let nl = rest.indexOf("\n");
      while (nl >= 0) {
        const raw = rest.slice(0, nl).trim();
        rest = rest.slice(nl + 1);
        nl = rest.indexOf("\n");
        if (raw === "") continue;
        const msg = JSON.parse(raw) as {
          id?: number | null;
          result?: { content?: { text?: string }[]; isError?: boolean };
          error?: { message: string };
        };
        if (msg.error !== undefined) return done(`error: ${msg.error.message}`);
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: tool, arguments: args },
          });
        } else if (msg.id === 2) {
          const text = (msg.result?.content ?? []).map((c) => c.text ?? "").join("");
          return done(msg.result?.isError === true ? `error: ${text}` : text);
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mock-agent", version: "0" },
      },
    });
  });
}
