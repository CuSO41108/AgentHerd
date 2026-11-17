// The agents AgentHerd knows how to download and start (ADR 0066: Pi, Codex for GPT models,
// Claude Code for hard coding work), each at the version the maintainers adapted AgentHerd to.
// Downloads fetch exactly that version; the digest comes from the publisher (GitHub asset digest,
// npm integrity). Moving to a newer version is a code change, tested before release.

import type { AgentProfile } from "@agentherd/protocol";
import type { ArchiveRelease, Digest, NpmRelease, Release } from "./runtimes.ts";
import { nodeEnv } from "./runtimes.ts";

export type FetchJson = (url: string) => Promise<unknown>;
export type FetchText = (url: string) => Promise<string>;

export interface Fetchers {
  json: FetchJson;
  text: FetchText;
}

export interface AgentDef {
  id: string;
  name: string;
  /** Env variable naming an explicit CLI path. */
  envVar: string;
  /** Command names to look for on PATH. */
  systemNames: string[];
  /** Arguments that start the ACP server. */
  acpArgs: string[];
  /** Env the agent runs with so that writes and commands ask the owner. */
  env: Record<string, string>;
  /** The version AgentHerd is adapted to and downloads (ADR 0066). */
  version?: string;
  /** The release of `version` for a target (`darwin-arm64`, …); undefined when there is no build. */
  release?: (target: string, fetch: Fetchers) => Promise<Release | undefined>;
  /** Supported targets for downloads; omitted means all targets. */
  targets?: readonly string[];
  /** npm releases need npm itself, downloaded as the `npm` runtime. */
  npm?: boolean;
  /**
   * Files inside the install folder the agent cannot run without, e.g. a platform build npm
   * fetches as an optional dependency and skips without an error when its download fails.
   */
  requires?: (target: string) => readonly string[];
}

const GITHUB = "https://api.github.com/repos";
const NPM = "https://registry.npmjs.org";

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

/** An asset of the GitHub release tagged `tag`; the version is the tag without a leading "v". */
export async function githubAsset(
  fetch: Fetchers,
  repo: string,
  tag: string,
  name: string,
): Promise<{ version: string; url: string; digest: Digest; bytes: number } | undefined> {
  const release = (await fetch.json(`${GITHUB}/${repo}/releases/tags/${tag}`)) as GithubRelease;
  const asset = release.assets.find((a) => a.name === name);
  if (asset === undefined) return undefined;
  const [algorithm, value] = (asset.digest ?? "").split(":");
  if (algorithm !== "sha256" || value === undefined || value === "") {
    throw new Error(`${repo} ${name} has no SHA-256 digest`);
  }
  return {
    version: release.tag_name.replace(/^v/, ""),
    url: asset.browser_download_url,
    digest: { algorithm: "sha256", encoding: "hex", value },
    bytes: asset.size,
  };
}

/** A version of an npm package ("latest" by default) with its tarball and integrity. */
export async function npmVersion(
  fetch: Fetchers,
  name: string,
  version = "latest",
): Promise<{ version: string; tarball: string; digest: Digest }> {
  const meta = (await fetch.json(`${NPM}/${name}/${version}`)) as {
    version: string;
    dist: { tarball: string; integrity?: string };
  };
  const integrity = meta.dist.integrity ?? "";
  if (!integrity.startsWith("sha512-")) throw new Error(`${name} has no sha512 integrity`);
  return {
    version: meta.version,
    tarball: meta.dist.tarball,
    digest: { algorithm: "sha512", encoding: "base64", value: integrity.slice("sha512-".length) },
  };
}

function split(target: string): { os: string; arch: string } {
  const [os = "", arch = ""] = target.split("-");
  return { os, arch };
}

/** The Pi version AgentHerd's bridge is adapted to (ADR 0066). */
export const PI_VERSION = "1.5.0";
/** codex-acp, Codex's ACP adapter (ADR 0031, 0066). */
export const CODEX_ACP_VERSION = "2.5.0";
/** claude-agent-acp, Claude Code's ACP adapter (ADR 0066). */
export const CLAUDE_ACP_VERSION = "0.107.2";

async function piRelease(target: string, fetch: Fetchers) {
  const tag = `v${PI_VERSION}`;
  const { os, arch } = split(target);
  if (!["darwin", "linux", "win32"].includes(os) || !["arm64", "x64"].includes(arch)) {
    return undefined;
  }
  if (os === "win32") {
    // The Windows build is a zip with pi.exe at its top level.
    const asset = await githubAsset(fetch, "earendil-works/pi", tag, `pi-windows-${arch}.zip`);
    return asset === undefined ? undefined : archive("pi", asset, "zip", "pi.exe", "exec");
  }
  const asset = await githubAsset(fetch, "earendil-works/pi", tag, `pi-${os}-${arch}.tar.gz`);
  if (asset === undefined) return undefined;
  return archive("pi", asset, "tar.gz", "pi/pi", "exec");
}

function npmAgent(id: string, pkg: string, pinned: string, bin: string) {
  return async (_target: string, fetch: Fetchers): Promise<NpmRelease> => {
    const { version } = await npmVersion(fetch, pkg, pinned);
    return {
      kind: "npm",
      id,
      version,
      package: pkg,
      executable: `node_modules/${pkg}/${bin}`,
    };
  };
}

/**
 * Claude Code's native CLI, an optional dependency of the Agent SDK per platform
 * (`@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`, about 350 MB).
 */
export function claudeNativeBinary(target: string): string {
  const exe = target.startsWith("win32-") ? "claude.exe" : "claude";
  return `node_modules/@anthropic-ai/claude-agent-sdk-${target}/${exe}`;
}

/** npm itself, used to install npm-published agents. */
export async function npmRuntime(fetch: Fetchers): Promise<ArchiveRelease> {
  const npm = await npmVersion(fetch, "npm");
  return {
    kind: "archive",
    id: "npm",
    version: npm.version,
    url: npm.tarball,
    digest: npm.digest,
    bytes: 0,
    format: "tar.gz",
    executable: "package/bin/npm-cli.js",
    check: "node",
  };
}

function archive(
  id: string,
  asset: { version: string; url: string; digest: Digest; bytes: number },
  format: ArchiveRelease["format"],
  executable: string,
  check: ArchiveRelease["check"],
): ArchiveRelease {
  return { kind: "archive", id, ...asset, format, executable, check };
}

export const AGENTS: AgentDef[] = [
  {
    id: "pi",
    name: "Pi",
    envVar: "AGENTHERD_PI",
    systemNames: ["pi"],
    acpArgs: [],
    env: {},
    version: PI_VERSION,
    release: piRelease,
  },
  {
    id: "codex",
    name: "Codex",
    envVar: "AGENTHERD_CODEX",
    systemNames: ["codex-acp"],
    acpArgs: [],
    // read-only: Codex asks before editing files or using the network. No ChatGPT browser login:
    // AgentHerd hands Codex the owner's GPT model and key (ADR 0031).
    env: { INITIAL_AGENT_MODE: "read-only", NO_BROWSER: "1" },
    version: CODEX_ACP_VERSION,
    release: npmAgent(
      "codex",
      "@agentclientprotocol/codex-acp",
      CODEX_ACP_VERSION,
      "dist/index.js",
    ),
    npm: true,
  },
  {
    id: "claude",
    name: "Claude Code",
    envVar: "AGENTHERD_CLAUDE",
    systemNames: ["claude-agent-acp"],
    acpArgs: [],
    // Asking before edits and commands comes from the settings in its CLAUDE_CONFIG_DIR
    // (claude-home.ts); no browser login, the owner's Anthropic-style service supplies the key.
    env: { NO_BROWSER: "1" },
    version: CLAUDE_ACP_VERSION,
    release: npmAgent(
      "claude",
      "@agentclientprotocol/claude-agent-acp",
      CLAUDE_ACP_VERSION,
      "dist/index.js",
    ),
    requires: (target) => [claudeNativeBinary(target)],
    npm: true,
  },
];

export function agentDef(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Scripts run with AgentHerd's own Node (Electron's in the app); binaries run directly. */
export function isScript(path: string): boolean {
  return /\.(c|m)?js$/i.test(path);
}

/**
 * A profile that starts `def` from `bin`. Pi goes through AgentHerd's ACP bridge (ADR 0022),
 * which `piCommand` supplies.
 */
export function agentProfile(
  def: AgentDef,
  bin: string,
  extraEnv: Record<string, string> = {},
): AgentProfile {
  const script = isScript(bin);
  return {
    id: def.id,
    name: def.name,
    command: script ? [process.execPath, bin, ...def.acpArgs] : [bin, ...def.acpArgs],
    env: { ...(script ? nodeEnv() : {}), ...def.env, ...extraEnv },
    exporter: null,
  };
}

/** Default fetchers: GitHub and npm JSON, plain text for feeds. */
export const httpFetchers: Fetchers = {
  json: async (url) => {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "AgentHerd" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  },
  text: async (url) => {
    const response = await fetch(url, { headers: { "user-agent": "AgentHerd" } });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
  },
};
