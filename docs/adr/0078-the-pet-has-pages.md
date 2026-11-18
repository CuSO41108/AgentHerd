# ADR 0078: The pet has three pages: 对话, 任务, 卡片

- Status: Accepted
- Date: 2026-11-19
- Changes: [0072](0072-cards-in-the-pet.md) (cards and task cards were only mixed into the
  conversation), [0073](0073-the-pets-conversation-looks-like-a-chat.md) (the panel was one list)

## Context

- Since ADR 0072 the pet's panel is one long list: the Herder's replies, the owner's messages,
  task events, every card and a task card for each task, in time order. To find the task that
  is running or the card that waits, the owner scrolls through the whole conversation.
- The owner (2026-11-19), asked what to do next: 「我需要我们的桌宠多几个按钮可以看到更多东西，
  比如卡片」, then 「比如当前任务之类的。。。一个页面还是有点累的」 (m24168).
- Other agent pets and overlays show running sessions apart from the chat (Codex pets, Claude
  Island, Vibe Island, CrossPet; notes in the owner's `pet-mock/pet-research-2026-11-19.md`).

## Decision

1. **Three tabs under the panel's header**: 对话, 任务, 卡片. The input stays below all of them;
   sending switches to 对话, where the message shows.
2. **对话** is the conversation as before (ADR 0073), cards and task cards included, so nothing
   moves out of the conversation.
3. **任务** lists tasks as task cards (ADR 0072): 「在跑」 (queued, working, stuck or waiting for
   the owner — the ones that wait first, then stuck, working, queued; newest first within each)
   and 「一天内结束的」 (done or failed in the last 24 hours, newest first). 打开 and 停止 work as
   in the conversation. The tab shows how many are running.
4. **卡片** lists the cards herd.db keeps (ADR 0072): 「等你处理」 (cards whose buttons still work,
   oldest first, the order they came in) and 「最近的卡片」 (the rest, newest first). The tab shows
   how many wait, in amber. The note 「N 件等你确认」 above the input now opens this page (it
   scrolled the conversation before) and is hidden on it.
5. **The page is kept** (`localStorage` `agentherd.pet.tab`). A new line that opens a closed
   panel opens it on 对话; when the panel is open on another page, the line is counted on the
   对话 tab instead of switching pages under the owner.
6. Each page starts at its top except 对话, which opens at its newest message as before.
7. A task card names the model once (「Pi · deepseek-flash」; the host's agent label already
   carries the model).

## Alternatives

- **A separate window or the main app's tasks page**: the main app has a full tasks page; the
  pet is for a glance without leaving what the owner is doing. 打开 on a task card still opens
  the task in the main app.
- **A strip of running tasks above the conversation** (the first cards mock): always visible, but
  takes room from the conversation and grows with tasks; rejected in ADR 0072 too.
- **Filters inside one list**: the same list with chips to hide kinds; harder to read than pages
  and the counts would not be in sight.

## Consequences

- Nothing new is stored and no host API changes: the pages are built from `pet()` and `tasks()`
  the pet already reads.
- The panel's list height is unchanged; the tab bar takes about 34 px of the panel.

## Tests

- `apps/desktop/test/pet-state.test.ts` "the pet's pages (ADR 0078)": unknown saved page reads as
  对话; running tasks ordered (waiting first) and ended tasks only of the last day; waiting cards
  in arrival order and the rest newest first; the model named once.
- Checked in the running app: each tab shows its page and counts (screenshots in the PR).
