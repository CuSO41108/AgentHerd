# ADR 0068: Sign in to model subscriptions; tokens per request

- Status: Accepted
- Date: 2026-11-17
- Refines: [ADR 0021](0021-model-list-then-choose-per-role.md) (services with keys),
  [ADR 0022](0022-pi-through-a-bundled-acp-bridge.md) (Pi through our bridge),
  [ADR 0067](0067-agents-ship-inside-the-app.md) (Pi and Codex in the app)

## Context

- A model service needed an API key. Many owners pay for a plan instead (ChatGPT Plus/Pro,
  Claude Pro/Max, GitHub Copilot, Kimi Code, SuperGrok) and have no key; the owner asked for
  sign-in with those accounts, for every vendor that offers it.
- pi-ai 1.5.0, which the Herder and Pi already use, ships the sign-in flows: every provider with
  `auth.oauth` (browser callback, device code, pasted code, choices), plus refresh. PI-Desktop
  (`~/learnspace/PI-Desktop`, its ADR 0095) builds on the same library: the credential stays in
  the main process and the agent process asks for a token before each request.
- Subscription tokens last about an hour; a task can run for hours. A token put into the agent's
  environment at start would expire mid-task. Pi caches a `!command` key for the whole run, so
  that cannot refresh either.
- Some vendors shape requests by the token itself (Claude's OAuth token switches on Claude Code
  headers; the ChatGPT token carries the account id), so a local proxy with a fake key would
  break them.

## Decision

1. **A service can be a sign-in.** `ModelService.auth = "subscription"` on a built-in service
   whose `provider` is a pi-ai OAuth provider. The vendor list is pi-ai's (`subscriptionProviders()`
   in `packages/herder/src/logins.ts`), not ours, so new vendors appear with a pi-ai update. All
   of them are offered, Claude included, with a 「注意条款」 badge on Anthropic, whose terms have
   limited third-party use of personal plans.
2. **The credential stays in the host.** It is saved in `secrets.json` under
   `model-login:<serviceId>` (`SecretCredentials`, one pi-ai `CredentialStore` per service;
   changes run one at a time so concurrent requests refresh once). Removing the service removes
   it.
3. **Every request gets a fresh token.** The Herder and memory jobs send through
   `requestStream()`: a subscription model (marked with `agentherdLogin` = service id) asks
   `ModelLogins.auth(service)` for a `ModelAuth` (pi-ai refreshes when needed) and applies key,
   headers and the account's own address. A failed sign-in becomes a model error, not a crash.
4. **Pi asks the host per request.** For a subscription model the bridge loads
   `extension/login.ts` instead of `model.ts`. It registers the model with its own stream function
   that sends `agentherd/modelAuth {service}` over the host's local MCP socket, with a token minted
   for that launch (`AGENTHERD_PI_AUTH_SOCKET`, `AGENTHERD_PI_AUTH_TOKEN`), then streams with pi-ai.
   The token can only fetch that one service's short token; Pi never sees the refresh token.
5. **Codex does not run subscription models**; they run in Pi. Codex would need the account's
   refresh token outside the host, and its ChatGPT sign-in is its own login, not ours.
6. **The 模型 page** gets 「用订阅登录」 next to 「添加服务」: pick a vendor, then the dialog shows
   what the flow asks for — 打开登录页, a device code with 复制, a pasted code or a choice — and
   saves the service with the models the account offers (catalog list when the vendor gives none).
   A subscription service card shows 订阅登录 / 已登录 and 登录 / 重新登录. Host API:
   `subscriptions()`, `startLogin(provider, serviceId, name?)`, `answerLogin`, `cancelLogin`,
   progress as `login` events. One sign-in runs at a time.

## Alternatives

- **A local proxy that adds the token**: one code path for every agent, but breaks vendors that
  read the token (decision context) and adds a server.
- **Token in the environment at launch**: simple, expires after an hour.
- **Only ChatGPT and Copilot**: the owner asked for all of them.

## Consequences

- Owners with a plan and no key can use AgentHerd; the Herder, memory jobs and Pi tasks use it.
- GPT models from a ChatGPT sign-in run in Pi, not Codex.
- Using a personal plan from a third-party tool may break a vendor's terms; the app says so for
  Anthropic and the owner decides.
- Not tested against real accounts yet (only unit and host tests with stored credentials).
