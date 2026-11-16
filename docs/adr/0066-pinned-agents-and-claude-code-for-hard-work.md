# ADR 0066: Pinned agent versions, no DSH, Claude Code for hard coding work

- Status: Accepted
- Date: 2026-11-16
- Supersedes: the latest-release downloads and the 更新 button of
  [ADR 0024](0024-follow-latest-releases-six-agents.md); DSH and the agent list of
  [ADR 0031](0031-pick-the-agent-from-the-model.md); [ADR 0042](0042-dsh-runs-the-owners-models.md)

## Context

- Agent downloads followed upstream's latest release, and the Agent page had an 更新 button that
  replaced the copy in use. A stray click moved Pi from 1.5.0 to 1.5.2 on the maintainer's Mac,
  a version nobody had tested with pi-acp's gate and steering. The owner said they want to adapt
  and install new versions themselves.
- DSH runs from the DeepSeek Harness desktop app installed on one Mac. Other owners do not
  have it, its download is a ~350 MB nightly app, and it needed its own model patch (ADR 0042).
  The owner asked to drop it and add Claude Code instead.
- The owner's rule: GPT models run in Codex, simple tasks in Pi, complex coding tasks in
  Claude Code.

## Decision

1. **Pinned versions.** Each agent in `packages/host/src/catalog.ts` has one adapted version:
   Pi `1.5.0` (GitHub tag `v1.5.0`), `@agentclientprotocol/codex-acp` `2.5.0`,
   `@agentclientprotocol/claude-agent-acp` `0.107.2`. Downloads and the start-up install fetch
   only that version; a managed copy of another version is replaced at start. Moving to a new
   upstream version is a code change.
2. **No 更新 button.** The Agent page offers 下载 only when an agent is missing;
   `installAgent` refuses an installed agent. The page shows the adapted version.
3. **DSH removed** as a built-in agent, with its app lookup, update feed and patch overlay.
   An owner can still add any ACP command as a profile.
4. **Claude Code added** through `claude-agent-acp`. It runs only `anthropic-messages` models:
   the host passes `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (and the same id
   for the default Opus/Sonnet/Haiku, small-fast and subagent models) and
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. `CLAUDE_CONFIG_DIR` points at
   `<home>/run/claude`, whose `settings.json` sets `permissions.defaultMode: "default"` and turns
   auto mode off, so every edit and command asks through ACP and reaches AgentHerd's approvals.
   It is downloaded when such a model is listed.
5. **Agent choice.** `session_start` gains `hard`: the Herder sets it for complex coding work.
   GPT models → Codex; `hard` and a model Claude Code can run → Claude Code, preferring such a
   model in tier order; otherwise Pi. A Claude Code or Codex task whose first turn breaks
   before acting switches to Pi with the same model (as ADR 0030 / 0044 for Codex).

## Consequences

- Owners get versions the maintainer tested; upstream fixes arrive only with an AgentHerd release.
- At the next start, the maintainer's Pi 1.5.2 is replaced by 1.5.0.
- Claude Code cannot run on the maintainer's Mac (endpoint security kills it, `Killed: 9`), so
  it is tested with the mock agent only; a real run needs another machine (Q01).
- Owners with only OpenAI-compatible services never use Claude Code; hard tasks go to Pi.
