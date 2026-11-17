# ADR 0067: Pi and Codex ship inside the app; Claude Code removed

- Status: Accepted
- Date: 2026-11-17
- Supersedes: the downloads (start-up install, 下载 button) of
  [ADR 0024](0024-follow-latest-releases-six-agents.md) and
  [ADR 0066](0066-pinned-agents-and-claude-code-for-hard-work.md); Claude Code and the `hard`
  flag of ADR 0066

## Context

- The app downloaded agents at run time: Pi at every start, Codex when a GPT model was listed,
  Claude Code when an Anthropic-API model was. The owner found it odd that installing the app
  quietly installs more programs, and said the agents should come with the app.
- Run-time downloads also failed in ways the owner had to read about: npm skipped Claude Code's
  ~350 MB platform CLI without an error (PRs #97, #98), and unauthenticated GitHub API calls hit
  rate limits.
- There was no installer yet; the app ran only as `pnpm --filter @agentherd/desktop dev`.
- Claude Code's CLI (`@anthropic-ai/claude-agent-sdk`) is "© Anthropic PBC. All rights reserved",
  use subject to Anthropic's legal agreements; other projects bundle only its open-source ACP
  adapter and leave the CLI to the user. On the maintainer's Mac endpoint security kills it
  anyway. The owner chose to drop Claude Code.

## Decision

1. **Agents inside the app.** Pi `1.5.0` and Codex (`@agentclientprotocol/codex-acp` `2.5.0`
   with the Codex CLI for the platform) are fetched at build time by
   `apps/desktop/scripts/fetch-agents.ts` (publisher's digest checked; an npm install without the
   platform CLI fails) into `Contents/Resources/agents` in RuntimeStore layout. The main process
   hands that folder to the host as `AGENTHERD_AGENTS`; in development it reads
   `apps/desktop/agents/` (git-ignored) when present.
2. **A macOS installer.** `apps/desktop/scripts/package-mac.ts` builds `AgentHerd.app` and
   `AgentHerd-<version>-<arch>.dmg` for the build Mac's architecture: Electron's bundle, the
   electron-vite output, the host's TypeScript sources laid out like the repo under
   `Resources/host/packages` (Electron's Node strips types, but not under `node_modules`, so
   workspace packages are linked into `Resources/host/node_modules`), its npm packages from
   `pnpm deploy --prod` (onnxruntime builds for other systems removed), and the agents. The
   executable is renamed so `app.isPackaged` holds. Signed ad hoc; signing and notarization stay
   in M5. The first build: 1.1 GB app, 492 MB dmg (agents 466 MB, host 376 MB).
3. **Nothing downloaded at run time.** No start-up install, no 下载 or 更新 button, no
   `installAgent` / `cancelInstall` in the host API. A new agent version comes with a new app.
   Lookup: `AGENTHERD_<ID>`, the copy in the app, a copy an older app downloaded into
   `<home>/runtimes` (read only; 移除 deletes it), `PATH`.
4. **Claude Code removed.** No built-in `claude` profile, no `hard` flag on `session_start`, no
   Claude env or settings home. GPT models run in Codex, the rest in Pi (ADR 0031). An owner can
   still add Claude Code as a config.json profile with their own install.

## Alternatives

- **Pi in the app, the others downloaded on a click.** Smaller app, but still a download path to
  maintain; the owner preferred everything in the installer.
- **Ship Claude Code's CLI too.** About 410 MB more and redistribution of all-rights-reserved
  software without permission.
- **electron-builder.** A large dependency for one macOS target; it also expects bundled
  JavaScript, while the host runs from TypeScript sources.

## Consequences

- Installing the app is all an owner does; Pi works offline from the first start.
- The dmg is about 500 MB and per architecture; an Intel or Windows build must be made on that
  system (npm installs the Codex CLI for the platform it runs on).
- Updating an agent means building and shipping a new app.
- Unsigned builds need right-click → 打开 the first time.
