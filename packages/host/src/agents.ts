// The agents the owner can run and where each CLI comes from (ADR 0067): the copy that ships inside
// the app, at the version AgentHerd is adapted to (catalog.ts), a CLI the owner names, or one on
// PATH. The app downloads nothing. The host keeps one Agents and rebuilds profiles when it changes.

import { existsSync } from "node:fs";
import type { AgentProfile } from "@agentherd/protocol";
import type { AgentSource, AgentView } from "./api.ts";
import { AGENTS, type AgentDef } from "./catalog.ts";
import { agentEnv, codexAppClis, envValue, onPath } from "./profiles.ts";
import type { RuntimeStore } from "./runtimes.ts";

export interface AgentsOptions {
  /** The agents that ship with the app (Resources/agents; scripts/fetch-agents.ts in dev). */
  bundled?: RuntimeStore;
  /** Copies an older app downloaded (<home>/runtimes); still used, never added to. */
  downloaded?: RuntimeStore;
  env?: NodeJS.ProcessEnv;
  /** Agent definitions (tests pass local ones). */
  catalog?: AgentDef[];
  exists?: (path: string) => boolean;
  /** Default: process.platform (decides how PATH is searched). */
  platform?: NodeJS.Platform;
  /** The Codex desktop app's CLI candidates. Default: codexAppClis(platform). */
  codexApps?: string[];
  onChange: () => void;
}

export interface AgentPath {
  path: string;
  source: AgentSource;
  version?: string;
}

export class Agents {
  private readonly opts: AgentsOptions;

  constructor(opts: AgentsOptions) {
    this.opts = opts;
  }

  get catalog(): AgentDef[] {
    return this.opts.catalog ?? AGENTS;
  }

  private get env(): NodeJS.ProcessEnv {
    return this.opts.env ?? process.env;
  }

  private exists(path: string): boolean {
    return (this.opts.exists ?? existsSync)(path);
  }

  /**
   * Where `id` runs from: its env variable, the copy in the app, a copy an older app downloaded,
   * then PATH.
   */
  find(id: string): AgentPath | undefined {
    const def = this.catalog.find((d) => d.id === id);
    if (def === undefined) return undefined;
    const explicit = envValue(this.env, def.envVar);
    if (explicit !== undefined && explicit !== "") return { path: explicit, source: "system" };
    const bundled = this.opts.bundled?.installed(id);
    if (bundled !== undefined) {
      return { path: bundled.path, source: "bundled", version: bundled.version };
    }
    const downloaded = this.opts.downloaded?.installed(id);
    if (downloaded !== undefined) {
      return { path: downloaded.path, source: "managed", version: downloaded.version };
    }
    const onSystem = onPath(
      def.systemNames,
      envValue(this.env, "PATH"),
      (p) => this.exists(p),
      this.opts.platform ?? process.platform,
    );
    return onSystem === undefined ? undefined : { path: onSystem, source: "system" };
  }

  private codexClis: string[] | undefined;

  /** Machine-specific env of agent `id` (agentEnv); the registry is read once per host. */
  extraEnv(id: string): Record<string, string> {
    const platform = this.opts.platform ?? process.platform;
    return agentEnv(
      id,
      this.env,
      (p) => this.exists(p),
      platform,
      () => {
        this.codexClis ??= this.opts.codexApps ?? codexAppClis(platform);
        return this.codexClis;
      },
    );
  }

  views(configured: AgentProfile[], modelRefs: Record<string, string>): AgentView[] {
    const views = this.catalog.map((def) => this.view(def));
    for (const p of configured) {
      const i = views.findIndex((v) => v.id === p.id);
      const view: AgentView = {
        id: p.id,
        name: p.name,
        state: "ready",
        source: "config",
        path: p.command[0] ?? "",
        canRemove: false,
      };
      if (i >= 0) views[i] = view;
      else views.push(view);
    }
    return views.map((v) => {
      const ref = modelRefs[v.id];
      return ref === undefined || v.source === "config" ? v : { ...v, modelRef: ref };
    });
  }

  private view(def: AgentDef): AgentView {
    const base = {
      id: def.id,
      name: def.name,
      ...(def.version === undefined ? {} : { adapted: def.version }),
    };
    const found = this.find(def.id);
    if (found === undefined) return { ...base, state: "missing", canRemove: false };
    return {
      ...base,
      state: "ready",
      source: found.source,
      path: found.path,
      ...(found.version === undefined ? {} : { version: found.version }),
      canRemove: found.source === "managed",
    };
  }

  /** Removes a copy an older app downloaded; the one in the app (or on PATH) takes over. */
  remove(id: string): void {
    if (this.opts.downloaded?.installed(id) === undefined) {
      throw new Error(`"${id}" was not downloaded by AgentHerd`);
    }
    this.opts.downloaded.remove(id);
    this.opts.onChange();
  }
}
