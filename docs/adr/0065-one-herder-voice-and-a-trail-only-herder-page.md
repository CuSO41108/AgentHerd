# ADR 0065: One Herder voice, and a 主管 page that is only its trail

- Status: Accepted
- Date: 2026-11-16
- Supersedes: decision 6 of [ADR 0053](0053-the-herder-tells-task-results.md) (three styles, picked by the owner)
- Changes: [04-herder](../spec/04-herder.md) (owner tools, style), [08-herder-interaction](../spec/08-herder-interaction.md) (§6 the 主管 page), [02-architecture](../spec/02-architecture.md) (local API)

## Context

ADR 0053 let the owner pick how the Herder talks: a capable friend, an opinionated partner or a
crisp secretary, in the first run, in Settings or in chat (`style_set`). The style was part of
the system prompt. Two things came out of it in use:

- **A switch muddles the conversation.** The Herder keeps its whole conversation (ADR 0045). After
  a switch the new style text sits on top of dozens of replies written in the old one, and the
  model blends the two. The owner (2026-11-16): 「这个调整我感觉 systemprompt 不就乱套了」.
- **A switch costs the whole prompt cache.** The system prompt is the start of the cached prefix,
  so every switch makes the next turn pay for the whole conversation again.

The app also showed the owner more than they wanted. The 主管 page had the Herder's model, a row
to the style page and a row to the action log ([08-herder-interaction](../spec/08-herder-interaction.md) §6). The owner asked for
the page to be only the trail of what the Herder did, the Herder's model to go back to the 模型
page, and the 「Pi 用的模型」 row to go: tasks pick their model from the tiers (ADR 0028), so the
row only confused (「这个我感觉很抽象，不要这一栏」).

## Decision

1. **One voice.** The Herder always talks as the capable friend (open-instinct's `PERSONA.md`, the
   old default). `packages/herder/src/style.ts` has one `stylePrompt()` with that voice and the
   shared rules of ADR 0054. There is no `HerderStyle` type, no `style_set` tool, no
   `herderStyle` in `config.json` or the local API, and no style step in the first run. An old
   `herderStyle` key in `config.json` is ignored.
2. **The 主管 page is the trail.** It shows the action log (every turn, what
   started it, each tool call and its result, the reply, errors and retries) and nothing above
   it. When the Herder is not working, one line says why, with a button to the 模型 page.
3. **Models live on the 模型 page.** Its first row is 「主管用的模型」 with 试一下, then the tiers,
   then the services. There is no row for Pi's model; the `pi` role stays in the host for Pi's
   own fallback, but the app does not show it.

## Alternatives

- **Keep the styles, switch only at a new conversation.** The Herder's conversation never starts
  over (ADR 0045), so there is no such moment.
- **Keep the styles and accept the cache miss.** The muddled tone is the larger problem; a cache
  miss does not fix it.
- **Keep a status card on the 主管 page.** The owner found it took the place of the trail; the
  model and its test already live on the 模型 page, and the sidebar dot shows when the Herder is
  off.

## Consequences

- The system prompt no longer changes when the owner changes a setting, only when the memory is
  refreshed.
- Owners who picked the partner or the secretary now get the friend. Old `style_set` calls still
  show in the action log under their name.
- One page fewer in the app (说话风格) and one first-run step fewer.
