# 0076. Tencent WeStock live market quotes and official research CLI

- Date: 2026-11-18
- Status: Accepted

## Context

When the owner asks about the latest stock market moves or an individual share (such as A-shares, Hong Kong equities, US equities, ETFs, or broad indices), AgentHerd should answer straight away instead of spinning up a heavy coding task or inventing numbers from training data. When the owner asks for deeper financial, technical, fund-flow, announcement, or research-report analysis, coding and research agents need structured market data too.

Tencent WeStock (腾讯自选股) publishes two upstream integration paths:

1. **`westock-mcp` (`https://stockbuddy.qq.com/cgi/cgi-bin/openai/mcp/mcp`)**: requires an OAuth 2.1 browser sign-in flow and returns HTTP `401` to unauthenticated clients.
2. **Public read-only market endpoints (`smartbox.gtimg.cn`, `qt.gtimg.cn`) and the `@tencent-adm/westock-data` SkillHub release (`westock` CLI `v0.0.2`)**: zero login, read-only, with official prebuilt binaries published alongside a `SHA256.txt` manifest.

Requiring an interactive WeChat/QQ OAuth login just to check whether A-shares are up today adds unnecessary friction and credential surface inside a local secretary tool.

## Decision

Integrate Tencent WeStock (腾讯自选股) as a **two-layer, zero-login, read-only capability**:

1. **Built-in live market quotes (`stock_quote` for the Herder and `WESTOCK_QUOTE` over MCP for tasks).**
   - `packages/host/src/westock.ts` resolves ticker codes, market summary phrases (`大盘`, `A股`, `港股`, `美股`), and company names via `https://smartbox.gtimg.cn/s3/`, filters warrants (`QZ`) and duplicate RMB HK counters (`hk8xxxx`) when primary HKD listings exist, ranks equities/ETFs ahead of indices unless an index is named, and fetches GBK-encoded live packets from `https://qt.gtimg.cn/q=`.
   - `stock_quote` is read-only and on unless switched off in 设置 › 应用连接 (`westockOff` in `config.json`). Calls to `stock_quote` do not mark a Herder turn as having acted externally.
2. **Optional pinned `westock` research CLI for task agents.**
   - Under 设置 › 应用连接 › 行情与投研 (`WestockSection`), the owner can run `连接测试` and install or remove the official `@tencent-adm/westock-data` CLI (`v0.0.2`).
   - Downloads from `https://stockbuddy.qq.com/release/skillhub/cli/v0.0.2/` are verified against pinned SHA-256 digests before atomic installation into `<home>/bin`, prepended cleanly to task `PATH` without duplicating `Path`/`PATH` keys on Windows, and described to new tasks via `toolNotes()`.
3. **Strict factual and non-advice guardrails.**
   - Both the Herder prompt and task notes instruct models never to fabricate quotes and to present objective market data as reference only, not investment advice. No account sign-in or order placement is ever wired.

## Consequences

- Everyday questions about the latest stock market conditions or ticker quotes return live data in one Herder turn with zero setup or credentials.
- Deeper multi-indicator or fundamental research can use the verified official `westock` CLI on request, while untrusted updates cannot enter silently because hashes and version are pinned in code.
- If Tencent changes the public `gtimg` packet format or publishes a newer `westock` CLI version, updating the parser or pinned `SHA-256` table is a small, testable host change.
