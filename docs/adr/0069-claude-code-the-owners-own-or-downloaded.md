# ADR 0069: Claude Code is back: the owner's own `claude`, or a download when asked

- Status: Accepted
- Date: 2026-11-17
- Supersedes: the removal of Claude Code in
  [ADR 0067](0067-agents-ship-inside-the-app.md); brings back the `hard` flag and the Claude Code
  env of [ADR 0066](0066-pinned-agents-and-claude-code-for-hard-work.md)

## Context

- ADR 0067 put Pi and Codex inside the app and dropped Claude Code, because Anthropic's CLI
  (`@anthropic-ai/claude-agent-sdk-<platform>`, "All rights reserved") may not ship in our
  installer.
- The owner asked for it back, "like OpenBot": use the Claude Code on the computer, and download
  it when there is none. OpenBot downloads Anthropic's npm build on the user's computer (pinned
  version, hash checked, no self-update) and falls back to the user's own `claude`.
- The owner does not want a Claude account sign-in: Claude Code should run on the owner's own
  model services ("cc 加其他 api"), e.g. Anthropic, or DeepSeek, Kimi or GLM Anthropic endpoints.
  Anthropic's terms forbid third-party apps from offering claude.ai login, and keys avoid that.

## Decision

1. **Claude Code is a built-in agent again** (`claude` in `packages/host/src/catalog.ts`,
   `@agentclientprotocol/claude-agent-acp` pinned at 0.107.2, `onRequest: true`). It is not in the
   app: `scripts/fetch-agents.ts` skips `onRequest` agents.
2. **The owner's own `claude` first.** `localClaude()` looks at `AGENTHERD_CLAUDE_CLI`, `PATH` and
   the places Anthropic's installers use; the adapter gets it as `CLAUDE_CODE_EXECUTABLE`.
3. **A download only when the owner presses 下载** on the **Agent** page, into
   `<home>/runtimes/claude/<version>/`. With the owner's `claude`, only the adapter comes down
   (npm `--omit=optional`); without it, also Anthropic's platform build, required to be present.
   A download without the platform build counts as missing unless the owner's `claude` is there.
   取消 and 移除 as before; nothing is updated, nothing downloads on its own.
4. **No Claude sign-in.** The model and key come from the owner's service through `ANTHROPIC_*`
   env (every model alias set to the chosen model); only Anthropic Messages models with a key run
   in it (`claudeCanRun`), not subscription sign-ins (ADR 0068). `CLAUDE_CONFIG_DIR` is
   AgentHerd's own (`<home>/run/claude`) with ask-first settings, so the owner's `~/.claude` and
   any claude.ai login there are not used.
5. **Routing as in ADR 0066:** GPT models → Codex; `session_start hard` → Claude Code when it is
   installed and the model fits; everything else → Pi. A Claude Code task whose first turn breaks
   before acting moves to Pi with the same model.

## Consequences

- Owners with Claude Code installed get it with no download; others get about 90 MB on request.
- AgentHerd never redistributes Anthropic's CLI.
- On this development Mac `claude` is killed by endpoint security (exit 137), so Claude Code is
  covered by unit and host tests only (Q01).
