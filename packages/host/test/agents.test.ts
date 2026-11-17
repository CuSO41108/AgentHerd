// Fetching agent CLIs (catalog.ts, runtimes.ts; used when the app is built), where the host finds
// them (Agents, ADR 0067) and the 验证 check, against a local HTTP server that serves fake archives.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import { afterEach, describe, expect, it } from "vitest";
import { Agents } from "../src/agents.ts";
import {
  AGENTS,
  type AgentDef,
  agentProfile,
  CODEX_ACP_VERSION,
  codexNativeBinary,
  PI_VERSION,
} from "../src/catalog.ts";
import { writeConfig } from "../src/config.ts";
import { Host } from "../src/host.ts";
import { type ArchiveRelease, type Release, RuntimeStore, windowsTar } from "../src/runtimes.ts";
import { verifyProfile } from "../src/verify.ts";

const SCRIPT = fileURLToPath(new URL("../../mock-agent/scripts/approve.yaml", import.meta.url));
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** Serves `files` (path → bytes) on localhost; returns the base URL. */
async function serve(files: Record<string, Buffer>): Promise<string> {
  const server = createServer((req, res) => {
    const body = files[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-length": body.length }).end(body);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const TOOL_BIN = process.platform === "win32" ? "tool/tool.cmd" : "tool/tool";

/** An archive with tool/tool (or tool/tool.cmd on Windows) printing `reported`. */
function fakeArchive(format: "tar.gz" | "zip", reported: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "fake-agent-"));
  mkdirSync(join(dir, "tool"));
  if (process.platform === "win32") {
    writeFileSync(join(dir, "tool", "tool.cmd"), `@echo off\r\necho ${reported}\r\n`);
  } else {
    writeFileSync(join(dir, "tool", "tool"), `#!/bin/sh\necho ${reported}\n`);
    chmodSync(join(dir, "tool", "tool"), 0o755);
  }
  const archive = join(dir, `a.${format}`);
  if (process.platform === "win32") {
    const tarArgs = format === "tar.gz" ? ["-czf"] : ["-a", "-cf"];
    execFileSync(windowsTar(), [...tarArgs, archive, "-C", dir, "tool"]);
  } else if (format === "tar.gz") {
    execFileSync("tar", ["-czf", archive, "-C", dir, "tool"]);
  } else {
    execFileSync("zip", ["-qr", archive, "tool"], { cwd: dir });
  }
  return readFileSync(archive);
}

function release(
  base: string,
  path: string,
  bytes: Buffer,
  patch: Partial<ArchiveRelease> = {},
): ArchiveRelease {
  return {
    kind: "archive",
    id: "tool",
    version: "9.9.9",
    url: `${base}${path}`,
    digest: {
      algorithm: "sha256",
      encoding: "hex",
      value: createHash("sha256").update(bytes).digest("hex"),
    },
    bytes: bytes.length,
    format: path.endsWith(".zip") ? "zip" : "tar.gz",
    executable: TOOL_BIN,
    check: "exec",
    ...patch,
  };
}

describe("RuntimeStore", () => {
  it("still finds a Pi downloaded before current.json existed", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    const dir = join(root, "pi", "1.5.0");
    mkdirSync(join(dir, "pi"), { recursive: true });
    writeFileSync(join(dir, "pi", "pi"), "");
    const store = new RuntimeStore(root);
    expect(store.installed("pi")).toBeUndefined();
    writeFileSync(join(dir, ".agentherd-ready"), "");
    expect(store.installed("pi")).toEqual({
      id: "pi",
      version: "1.5.0",
      path: join(dir, "pi", "pi"),
    });
    expect(store.installed("opencode")).toBeUndefined();
  });

  it("downloads, checks and unpacks a tar.gz and a zip", async () => {
    const tgz = fakeArchive("tar.gz", "9.9.9");
    const zip = fakeArchive("zip", "tool 9.9.9");
    const base = await serve({ "/a.tar.gz": tgz, "/a.zip": zip });
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")));
    expect(store.installed("tool")).toBeUndefined();
    const progress: number[] = [];
    const first = await store.install(release(base, "/a.tar.gz", tgz), {
      onProgress: (p) => progress.push(p.received),
    });
    expect(first.path).toBe(join(store.dir("tool", "9.9.9"), TOOL_BIN));
    expect(store.installed("tool")).toEqual(first);
    expect(progress.at(-1)).toBe(tgz.length);

    const next = await store.install(release(base, "/a.zip", zip, { version: "9.9.9" }));
    expect(next.version).toBe("9.9.9");
    const newer = fakeArchive("zip", "10.0.0");
    const base2 = await serve({ "/b.zip": newer });
    const updated = await store.install(release(base2, "/b.zip", newer, { version: "10.0.0" }));
    expect(store.installed("tool")).toEqual(updated);
    store.remove("tool");
    expect(store.installed("tool")).toBeUndefined();
  });

  it("refuses a download whose digest does not match", async () => {
    const tgz = fakeArchive("tar.gz", "9.9.9");
    const base = await serve({ "/a.tar.gz": tgz });
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")));
    const bad = release(base, "/a.tar.gz", tgz, {
      digest: { algorithm: "sha256", encoding: "hex", value: "0".repeat(64) },
    });
    await expect(store.install(bad)).rejects.toThrow(/does not match its SHA256/);
    expect(store.installed("tool")).toBeUndefined();
  });

  it("refuses a build that reports another version", async () => {
    const tgz = fakeArchive("tar.gz", "1.0.0");
    const base = await serve({ "/a.tar.gz": tgz });
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")));
    await expect(store.install(release(base, "/a.tar.gz", tgz))).rejects.toThrow(
      /reports version "1.0.0"/,
    );
  });

  it("needs npm for npm packages", async () => {
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")));
    await expect(
      store.install({ kind: "npm", id: "x", version: "1.0.0", package: "x", executable: "i.js" }),
    ).rejects.toThrow(/npm is not available/);
  });

  it("refuses an npm install that skipped a required file (a failed optional download)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "npm-"));
    const npmCli = join(dir, "fake-npm.js");
    writeFileSync(
      npmCli,
      [
        'const { mkdirSync, writeFileSync } = require("node:fs");',
        'const { join } = require("node:path");',
        'const prefix = process.argv[process.argv.indexOf("--prefix") + 1];',
        'const pkg = join(prefix, "node_modules", "x");',
        "mkdirSync(pkg, { recursive: true });",
        'writeFileSync(join(pkg, "package.json"), JSON.stringify({ version: "1.0.0" }));',
        'writeFileSync(join(pkg, "i.js"), "");',
      ].join("\n"),
    );
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "commonjs" }));
    const store = new RuntimeStore(join(dir, "rt"));
    const release: Release = {
      kind: "npm",
      id: "x",
      version: "1.0.0",
      package: "x",
      executable: "node_modules/x/i.js",
      requires: ["node_modules/x-native/bin"],
    };
    await expect(store.install(release, { npmCli })).rejects.toThrow(
      /npm did not install node_modules\/x-native\/bin/,
    );
    const { requires: _, ...plain } = release;
    await expect(store.install(plain, { npmCli })).resolves.toMatchObject({ version: "1.0.0" });
    // Installed without the file: asking for it again reinstalls instead of keeping the copy.
    await expect(store.install(release, { npmCli })).rejects.toThrow(/npm did not install/);
  });
});

describe("catalog", () => {
  it("fetches exactly the versions AgentHerd is adapted to, never upstream's latest (ADR 0066, 0067)", async () => {
    expect(AGENTS.map((a) => [a.id, a.version])).toEqual([
      ["pi", PI_VERSION],
      ["codex", CODEX_ACP_VERSION],
    ]);
    const asked: string[] = [];
    const fetchers = {
      json: async (url: string) => {
        asked.push(url);
        if (url.includes("api.github.com")) {
          return {
            tag_name: `v${PI_VERSION}`,
            assets: [
              {
                name: "pi-darwin-arm64.tar.gz",
                browser_download_url: "https://dl/pi.tgz",
                size: 1,
                digest: "sha256:ab",
              },
            ],
          };
        }
        const version = url.split("/").at(-1);
        return { version, dist: { tarball: "t", integrity: "sha512-x" } };
      },
      text: async () => "",
    };
    const releases = await Promise.all(AGENTS.map((a) => a.release?.("darwin-arm64", fetchers)));
    expect(releases.map((r) => r?.version)).toEqual([PI_VERSION, CODEX_ACP_VERSION]);
    expect(asked).toEqual([
      `https://api.github.com/repos/earendil-works/pi/releases/tags/v${PI_VERSION}`,
      `https://registry.npmjs.org/@agentclientprotocol/codex-acp/${CODEX_ACP_VERSION}`,
    ]);
    expect(asked.some((u) => u.endsWith("/latest"))).toBe(false);
  });

  it("names the Codex CLI a codex-acp install must hold", () => {
    expect(codexNativeBinary("darwin-arm64")).toEqual([
      "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
    ]);
    expect(codexNativeBinary("win32-x64")[0]).toMatch(/x86_64-pc-windows-msvc\/bin\/codex\.exe$/);
    expect(codexNativeBinary("plan9-mips")).toEqual([]);
    expect(AGENTS.find((a) => a.id === "codex")?.requires).toBe(codexNativeBinary);
  });

  it("runs scripts with Node and binaries directly, with the agent's ask-first env", () => {
    const def: AgentDef = {
      id: "codex",
      name: "Codex",
      envVar: "X",
      systemNames: [],
      acpArgs: [],
      env: { INITIAL_AGENT_MODE: "read-only" },
    };
    const script = agentProfile(def, "/r/node_modules/x/dist/index.js");
    expect(script.command).toEqual([process.execPath, "/r/node_modules/x/dist/index.js"]);
    expect(script.env).toMatchObject({ INITIAL_AGENT_MODE: "read-only" });
    const bin = agentProfile({ ...def, acpArgs: ["acp"] }, "/r/opencode");
    expect(bin.command).toEqual(["/r/opencode", "acp"]);
    const upperScript = agentProfile(def, "C:\\rt\\index.JS");
    expect(upperScript.command).toEqual([process.execPath, "C:\\rt\\index.JS"]);
  });
});

/** A store holding `copies` (id → version), as RuntimeStore.installed reports them. */
function storeWith(root: string, copies: Record<string, string>): RuntimeStore {
  return {
    installed: (id: string) => {
      const version = copies[id];
      return version === undefined ? undefined : { id, version, path: `${root}/${id}` };
    },
    remove: (id: string) => {
      delete copies[id];
    },
  } as unknown as RuntimeStore;
}

describe("Agents (ADR 0067)", () => {
  it("runs the copy in the app first, then an older app's download, then PATH", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const onPath = join("/usr/bin", process.platform === "win32" ? "codex-acp.exe" : "codex-acp");
    const agents = new Agents({
      bundled: storeWith("/app/agents", { pi: PI_VERSION }),
      downloaded: storeWith("/home/runtimes", { pi: "1.5.2", codex: "2.4.0" }),
      env: { PATH: ["/usr/bin"].join(sep) },
      exists: (p) => p === onPath,
      onChange() {},
    });
    expect(agents.find("pi")).toEqual({
      path: "/app/agents/pi",
      source: "bundled",
      version: PI_VERSION,
    });
    expect(agents.find("codex")).toMatchObject({ source: "managed", version: "2.4.0" });
    expect(
      agents.views([], {}).map((v) => [v.id, v.source, v.version, v.adapted, v.canRemove]),
    ).toEqual([
      ["pi", "bundled", PI_VERSION, PI_VERSION, false],
      ["codex", "managed", "2.4.0", CODEX_ACP_VERSION, true],
    ]);
    agents.remove("codex");
    expect(agents.find("codex")).toMatchObject({ source: "system" });
    agents.remove("pi");
    expect(agents.find("pi")).toMatchObject({ source: "bundled" });
    expect(() => agents.remove("pi")).toThrow(/not downloaded/);
    const none = new Agents({ env: { PATH: "" }, exists: () => false, onChange() {} });
    expect(none.views([], {}).map((v) => v.state)).toEqual(["missing", "missing"]);
    // An explicit CLI wins over the copy in the app.
    const named = new Agents({
      bundled: storeWith("/app/agents", { pi: PI_VERSION }),
      env: { PATH: "", AGENTHERD_PI: "/opt/pi" },
      onChange() {},
    });
    expect(named.find("pi")).toEqual({ path: "/opt/pi", source: "system" });
  });

  it("hands codex-acp the Codex app's CLI when the owner has the app", () => {
    const CLI = "C:\\Apps\\OpenAI.Codex\\app\\resources\\codex.exe";
    const agents = (env: NodeJS.ProcessEnv) =>
      new Agents({
        env,
        platform: "win32",
        exists: (p) => p === CLI,
        codexApps: [CLI],
        onChange() {},
      });
    expect(agents({}).extraEnv("codex")).toEqual({ CODEX_PATH: CLI });
    expect(agents({ CODEX_PATH: "C:\\mine\\codex.exe" }).extraEnv("codex")).toEqual({});
  });
});

function makeHost(
  home: string,
  catalog: AgentDef[],
  extra: { script?: string; agentsDir?: string } = {},
) {
  return new Host({
    home,
    userHome: home,
    secrets: { get: () => undefined, set() {}, delete() {} },
    env: { PATH: "" },
    createChannel: () => new FakeChannel(),
    runtimes: new RuntimeStore(join(home, "runtimes")),
    catalog,
    exists: () => false,
    ...extra,
  });
}

describe("Host agents", () => {
  it("starts the agents that ship with the app and downloads nothing (ADR 0067)", async () => {
    const tgz = fakeArchive("tar.gz", PI_VERSION);
    const base = await serve({ "/a.tar.gz": tgz });
    const home = mkdtempSync(join(tmpdir(), "ah-"));
    const agentsDir = join(home, "app-agents");
    await new RuntimeStore(agentsDir).install(
      release(base, "/a.tar.gz", tgz, { id: "pi", version: PI_VERSION }),
    );
    writeConfig(home, { channel: { channelId: "fake", ownerId: "owner", data: {} } });
    const host = makeHost(home, AGENTS, { agentsDir });
    await host.start();
    try {
      expect(host.agents().map((a) => [a.id, a.state, a.source, a.version])).toEqual([
        ["pi", "ready", "bundled", PI_VERSION],
        ["codex", "missing", undefined, undefined],
      ]);
      expect(host.status().profiles).toEqual(["pi"]);
      expect(() => host.removeAgent("pi")).toThrow(/not downloaded/);
      expect("installAgent" in host).toBe(false);
    } finally {
      await host.stop();
    }
  });

  it("checks an agent by starting it and opening a session", async () => {
    const home = mkdtempSync(join(tmpdir(), "ah-"));
    const host = makeHost(home, [], { script: SCRIPT });
    await host.start();
    try {
      const check = await host.verifyAgent("mock");
      expect(check).toMatchObject({ id: "mock", ok: true, needsLogin: false });
      expect(await host.verifyAgent("nope")).toMatchObject({ ok: false, error: "not installed" });
    } finally {
      await host.stop();
    }
  });
});

describe("verifyProfile", () => {
  it("reports a CLI that exits at once, with its stderr", async () => {
    const check = await verifyProfile({
      id: "broken",
      name: "Broken",
      command: [process.execPath, "-e", "console.error('please run login first'); process.exit(3)"],
      env: {},
      exporter: null,
    });
    expect(check.ok).toBe(false);
    expect(check.needsLogin).toBe(true);
    expect(check.error).toMatch(/login/);
  });

  it("gives up after the timeout", async () => {
    const check = await verifyProfile(
      {
        id: "slow",
        name: "Slow",
        command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        env: {},
        exporter: null,
      },
      { timeoutMs: 300 },
    );
    expect(check).toMatchObject({ ok: false, error: expect.stringMatching(/no answer within/) });
  });
});
