# ADR 0072: The pet shows the cards Feishu shows, and a card for each task

- Status: Accepted; how the cards look changed by [0073](0073-the-pets-conversation-looks-like-a-chat.md)
- Date: 2026-11-18
- Changes: [0070](0070-a-desktop-pet.md) (the pet showed the Herder's lines as text and only the
  first card that waited for the owner)

## Context

- The owner, after the pet became the whole conversation (ADR 0070): 「继续做卡片，还有任务卡」
  (m21012), and agreed to the plan on 2026-11-18 (「可以的」, m21088): the pet shows what Feishu
  shows as cards — a task's report, an approval, the Herder's question — plus a card for each task
  with its stage and a way to stop or open it; cards stay after a restart; no task strip on top.
- What the pet had: `herder_turns` (text lines of the Herder's conversation) and the one card that
  waited for the owner, kept in memory. A report came as plain text without its color, its
  agent's own words or the steps decided automatically; an approval card vanished once answered;
  nothing told what a task was doing now.
- Feishu keeps its cards; AgentHerd only sent them. A restart lost everything the pet knew about
  them.
- Stopping a task: the owner could only say so to the Herder (`session_end`). Ending a task in the
  middle of a turn also sent a red report 「任务失败：你说这个任务结束了」 — the turn failed because
  its agent was closed, so it looked like the task broke.

## Decision

1. **Cards are kept in herd.db.** New table `owner_cards` (schema 15): one row per card AgentHerd
   sent to the owner — report, approval (single or combined), the Herder's question, a text with
   buttons (an offer) — keyed by the channel's message ref, rewritten with its latest form when
   the card is updated (answered, closed). Secrets are redacted as elsewhere. The newest 500 are
   kept. The board card and plain text are not cards here: plain text is already a line of
   `herder_turns`, and the board is the tasks table.
2. **The pet tees cards as it tees lines** (ADR 0070 decision 1): `PetFeed` stores every card view
   it sees go out or change. `PetView.cards` has the cards of the time the conversation covers,
   each with `open` (it still takes a press). Lines a card already shows are left out of the
   history: the question text of an ask, the report body the Herder recorded for that task, the
   event lines that name the same report or approval.
3. **The pet draws them as Feishu does**: same header color and icon by result or risk (✅ green,
   ❌ red, ⚠️ orange, ⏹ grey; 高/中/低风险), the body folded at 400 characters behind 展开全部,
   「<agent> 的原话」 and 「自动处理的审批 · N」 folded, the command in a code block with its
   理由, the Herder's question with full-width answers. Buttons answer for the owner as before;
   one line of a combined approval card can be answered on its own. A closed card stays, grey,
   with what was chosen. A report card has 打开任务.
4. **A task card for each task, from the tasks table.** Tasks started over the time the
   conversation covers (or over the last day when there is none) show where they started, as a
   card: name, agent · model, how long it has run, its stage (排队中, 在做, 等你, 卡住了, 做完了,
   没做成) and its latest step, with 停止 (asks 确定停止 first) and 打开 (the main window opens on
   that task). It follows the task live: it is drawn from what the host reports, not sent as a
   message, so Feishu gets nothing more and the card is right after a restart.
5. **Stopping is the owner's own.** New host method `stopTask(taskId)` ends the task with the same
   reason as `session_end` (「你说这个任务结束了」). When that cuts a running turn, the report says
   so — result `stopped` (grey ⏹), body 「你停下了这个任务，做到一半的事没有做完。」 — instead of a
   failure.
6. **What waits is one tap away.** The cards that wait stay where they came in the conversation;
   above the input a line 「N 件等你处理 ↑」 scrolls to the first one. The dot still counts them.

## Alternatives

- **Send a task card to Feishu too, updated in place.** Rejected for now: the owner's complaint was
  too many tasks in Feishu (ADR 0071). The pinned board already shows them there.
- **A task strip on top of the conversation.** Shown in the mock, dropped by the owner: the task
  cards in the conversation say the same where the task started.
- **Keep views in memory only.** A restart loses every card; the pet would show a different past
  from Feishu.
- **Store all views, the board included.** The board changes every few seconds and is the tasks
  table already.

## Consequences

- herd.db grows by at most 500 card rows (a report with the agent's whole reply is the largest;
  the pet reads them cut to 4000 characters).
- The pet and Feishu show the same cards in the same order; the pet adds the task cards.
- A task the owner stops reports `stopped`, also in Feishu.
- Cards sent before this version are not in the table; the pet shows their lines as text, as
  before.

## Tests

- `packages/core/test/store.test.ts` — latest form, redaction, the 500 kept, migration from 14.
- `packages/host/test/pet.test.ts` — only cards are kept, open/closed, a line of a combined card,
  lines a card shows are left out, long reports cut; E2E-PET-CARDS: a task's report card in
  herd.db, `stopTask` stops a working task with a `stopped` report.
- `apps/desktop/test/pet-state.test.ts` — the conversation in time order with cards and tasks,
  elapsed time, report colors, folding.
