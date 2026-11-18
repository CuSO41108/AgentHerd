# ADR 0074: The Herder draws tables, numbers, steps, links and choices with herd-ui blocks

- Status: Accepted; a thirteenth component, `image`, added by [ADR 0075](0075-the-herder-shows-pictures.md)
- Date: 2026-11-18
- Changes: [0073](0073-the-pets-conversation-looks-like-a-chat.md) (what a reply can hold),
  [0072](0072-cards-in-the-pet.md) (a reply with choices is a card)

## Context

- The owner, looking at the pet: 「也不支持md渲染，也不支持genui，类似html那样的」 (m21756), then
  「genui是一定要做的，参考其他agent都genui咋做的呢」 (m21784) and 「你可以再看看pi-desktop里的genui，
  也可以看看zcode的、codex的」 (m22330).
- How others do it (four research reports, 2026-11-18):
  - Declarative components the host draws: A2UI 1.0 (JSON surfaces from a catalog), OpenClaw's
    `presentation` blocks (one spec, each channel draws what it can, Feishu cards included), the
    DSH GenUI plugin (a fenced JSON spec in the reply, 53 components, repaired and checked in
    code, broken parts dropped), ChatKit widgets, Adaptive Cards.
  - HTML the model writes, run in a sandboxed iframe: PI-Desktop, zcode and Codex
    (`::visualize{…}` / `::codex-inline-vis`), MCP Apps, Claude's `show_widget`.
  - Markdown only, buttons only for system flows: nanobot, Hermes.
- Feishu is the owner's main channel and can only show its own card elements; the pet can press
  approvals, so it must never run what a model wrote.
- The owner agreed on 2026-11-18 (「可以的」, m22357) to: declarative components first, a fenced
  block in the reply, the same spec drawn in the pet and in Feishu, PR 1 the new look
  ([ADR 0073](0073-the-pets-conversation-looks-like-a-chat.md)), PR 2 this.

## Decision

1. **A fenced block in the reply.** The Herder writes a ```` ```herd-ui ```` block holding one JSON
   object `{"title"?, "items": [...]}` after a sentence or two of plain words. The words are what a
   lock screen and anything that cannot draw the block shows. A reply stays one text message:
   herd.db keeps it as written (with the block), so it survives restarts and the Herder sees its
   own block in its context.
2. **Twelve components, flat.** `text` (Markdown), `table`, `keyvalue`, `stats`, `steps`, `list`,
   `callout`, `code`, `link`, `file`, `choices`, `divider`. No nesting, no layout, no colours the
   model picks; at most 30 items, 2,000 characters a string, tables 8 × 50, 6 choices. The
   catalog lives in one file, `packages/protocol/src/herd-ui.ts`, which both renderers import.
3. **Repaired in code, never trusted.** `readHerdUi` takes the JSON loosely (comments, trailing
   commas, bare keys, raw newlines, a cut-off end), maps other names for types and fields
   (`markdown`→`text`, `kv`→`keyvalue`, `repo`→`link`, `buttons`→`choices`…), turns an unknown type
   with words into text and drops the rest, each with a written reason. Links must be http(s),
   files a full path. Before a reply is sent the Herder checks it (`checkHerdUi`): a repaired
   block goes out normalized; a block with nothing usable gets one rewrite in the same turn, with
   a note marked "not from the owner" listing what was wrong; if the rewrite fails too, only the
   words go. Audits `herder.ui.problems` and `herder.ui.rewrite`.
4. **One spec, three drawings.** The pet draws the components in React (no HTML from the model).
   Feishu draws them as card 2.0 elements: `table` elements (at most 5 a card, the rest as
   Markdown tables), `column_set` for numbers, a bordered `interactive_container` that opens a
   link, Markdown for the rest. Everything else gets `herdUiPlain`: Markdown text with the
   choices as a list. If Feishu refuses a card drawn from a block (codes 230001, 230025, 230099)
   the channel sends it once more drawn the old way, answers as ordinary buttons.
5. **Choices are the owner's answer.** A reply with choices goes out with a target `ui:<id>`; a
   press in the pet or in Feishu goes through the same handler (`OwnerCommands`): the card shows
   「你选了：x」 without buttons, and the Herder gets the press as the owner's answer to the
   choices' question. A second press, or one on a reply older than the 20 last ones with choices,
   is told the choice has expired. Choices are offers at the end of an answer; a question the
   Herder must have answered before it can go on stays the `ask` tool.
6. **Taught by example.** The system prompt's "Showing things" section (`herdUiPrompt`) says
   when a block is a must (things compared → table, several numbers → stats, three or more steps
   → steps, a repository or page → link, a file the owner should open → file, a command → code, a
   risk → callout, an offer at the end → choices), gives one line per component and one whole example reply, and
   ends with a check to do before sending. It sits after the context section, near the end of
   the prompt; a vaguer first version ("use one when it helps") was ignored.

## Measured

deepseek-flash (the Herder's model) on 20 messages, 12 that should get a block and 8 that should
not, in a Herder with no tasks or models (`packages/herder/test/eval-herd-ui.tmp.ts`, not kept):

| Prompt | Used when it should | Used when it should not | Broken after repair |
| --- | --- | --- | --- |
| First version ("use one when it helps") | 2 of 12 | 0 of 8 | 0 |
| Concrete must-list | 2 of 12 | 0 of 8 | 0 |
| Must-list + example + check, placed last | 7 of 12 (and 1 used `ask`) | 1 of 8 | 0 |
| Same, two more runs | 15 of 24 | 0 of 16 | 0 (1 repaired) |

No block needed a rewrite; the misses were plain Markdown lists, which the pet and Feishu draw
fine. The one block where none was wanted offered choices for a clarifying question.

## Alternatives

- **HTML in a sandboxed iframe (PI-Desktop, zcode, Codex).** Draws anything, but Feishu cannot
  show it, and the pet presses approvals in the same window. Kept for later, pet only, for charts.
- **A tool per component or a `present` tool (OpenClaw).** Typed, but the reply splits into
  several messages, models fill nested schemas badly, and the words and the block lose their
  order. A fence keeps one message.
- **A2UI.** A full protocol with surfaces and data binding, more than chat replies need; its
  catalog idea is kept.
- **Markdown only (nanobot, Hermes).** Already there (ADR 0073); no numbers, links or buttons.

## Consequences

- The system prompt grows by about 3,500 characters.
- A reply with a block is longer in herd.db and in the context; the pet keeps fenced lines up to
  12,000 characters instead of cutting them at 1,500.
- Feishu now gets `table` and `column_set` elements in ordinary replies; a field Feishu refuses
  falls back to the old card.
- Not seen with real Feishu at the time of writing: every element field follows the Feishu docs
  (open.feishu.cn card JSON 2.0: table, column set, interactive container, open_url).

## Tests

- `packages/protocol/test/herd-ui.test.ts`: parsing, repair, aliases, limits, plain text, choices.
- `packages/herder/test/herd-ui.test.ts`: the prompt, repair without rewrite, one rewrite, words
  only when it fails.
- `packages/core/test/e2e/herd-ui-choices.e2e.test.ts` (E2E-HERD-UI-CHOICES): a press becomes the
  owner's answer, the card shows the choice, a second press has expired.
- `packages/host/test/pet.test.ts`: a reply with choices is a card in the pet and can be pressed.
- `packages/channel-feishu/test/herd-ui-card.test.ts`, `herd-ui-fallback.test.ts`: the elements,
  numbering, table cap, and the plain card when Feishu refuses.
- `apps/desktop/test/herd-ui-state.test.ts` (pet drawing helpers).
