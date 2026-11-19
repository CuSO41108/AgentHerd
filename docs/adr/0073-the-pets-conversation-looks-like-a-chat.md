# ADR 0073: The pet's conversation looks like a chat: Markdown, files to open, quiet task rows

- Status: Accepted; replies can also hold herd-ui blocks (ADR 0074); replies in bubbles and every
  long reply folds (changed 2026-11-19, decisions 1 and 3)
- Date: 2026-11-18
- Changes: [0070](0070-a-desktop-pet.md) and [0072](0072-cards-in-the-pet.md) (how the conversation
  is drawn), [0045](0045-herder-context-folded-by-the-model.md) (the Herder's own replies carry no
  ref tag in its context)

## Context

- The owner, looking at the expanded pet: 「这个ui很丑，展开之后。。。」 (m21723) and 「而且目前展示都是
  一样的文字，也不支持md渲染，也不支持genui，类似html那样的」 (m21756).
- What the pet showed (live data, 73 lines): every line in the same grey bubble, Markdown as raw
  `**` and `- `, replies of up to 1,016 characters in full, task events that are shell commands
  (「下载并启动 yetone/magpie: cd /tmp/magpie-run && rm -f cookies.txt && curl …」) as big bubbles,
  file paths as plain text, and three replies that began with a line like
  `<acp tokens="39" type="text">m00205</p>`.
- That last line is the context kernel's ref tag (ADR 0045). The kernel put one in front of every
  earlier message, the Herder's own replies too; seeing it there, the model began writing tags
  itself, some with a broken ending that the tag filter (`</acp>` only) did not catch.
- The owner agreed on 2026-11-18 (「可以的」, m22357) to a plan in two steps: first this new look
  with Markdown and the tag fix, then generated UI (ADR 0074).

## Decision

1. **A chat, not a log.** The panel has a header (the figure's face, 「主管」, 「飞书已连接 · N 个任务在
   跑」, ↗ opens the app, ✕ closes), the owner's words in blue bubbles on the right, the Herder's
   replies without a bubble, and a time line at the start of a day and after ten quiet minutes. The
   input is a rounded field with a send button; 「N 件等你确认 ↑」 sits above it.
   - *Changed 2026-11-19:* without a bubble, one reply ran into the next and its paragraphs into
     each other: 「现在回答都粘在一起了」 (m23527), 「主管的回复也应该是一条一条的，而不是粘在一起的」
     (m23570). Each reply is now a grey bubble on the left (light and dark colours), as the owner's
     are blue on the right; tables, stats and code inside it sit on the panel's own colour. More
     room between messages (14 px), paragraphs (10 px, a blank line the Herder writes) and list
     items (4 px).
2. **Markdown.** The Herder's replies, report bodies and questions are drawn as Markdown by the app's
   own parser (`apps/desktop/src/renderer/src/markdown.ts`, the one the main window uses): it returns
   data, never HTML, so nothing in a message becomes markup. Links (http, https, mailto only) open
   in the browser; the pet window itself never navigates or opens windows.
3. **Long replies fold.** More than 12 lines or 600 characters show their start behind
   「展开全文 · 还有 N 行」.
   - *Changed 2026-11-19:* at first a reply with herd-ui blocks never folded. The owner:
     「每个回复的块都应该可以折叠」 (m24084). Now every long reply folds, blocks or not: long words (the
     blocks left out) or a drawn height over 280 px (a table, a picture), measured as it is drawn
     and again when it grows. 「展开全文」 opens it and 收起 folds it again. A reply whose answers
     are still open stays unfolded, so its buttons are in sight.
4. **Files to open.** A file the Herder wants the owner to open gets a row: name, folder, 打开.
   Main decides what 打开 does: documents, text, data and pictures open in their app; anything
   else (a script, an app, HTML) is only shown in Finder, so a message can never run code. A path
   that is not a file on this Mac does nothing.
   - *Changed the same day:* at first every path a reply named got a row, so a passing mention
     such as 「日志在 ~/Library/Logs/magpie/app.log」 showed up as a card under the answer. The
     owner: 「我理解这里要看这个文件重不重要吧？让大模型自己判断吧」 (m22988). Now only a herd-ui
     `file` item gets the row (ADR 0074); the Herder decides which files matter, and a path in its
     words stays text.
5. **Task events are quiet rows.** 「task · what happened」 on one muted line, whole on a click.
6. **Lighter cards.** Report, approval, question and offer cards keep what Feishu shows (ADR 0072)
   but use a tinted border instead of a coloured header bar; the task card is compact: title and
   stage pill, agent · model · time, latest step, a moving bar while it runs, 打开 and 停止.
7. **No ref tags in the Herder's own words.** The Herder's context shows ref tags only on the
   owner's messages and tool results; its own earlier replies go without them, and tags it wrote
   before are taken out of them. Any line that begins like a tag, whatever its ending, is removed
   from what is sent and from the pet's history read from herd.db.

## Alternatives

- **Restyle only, keep plain text.** Rejected: the owner asked for Markdown, and replies are written
  in Markdown already.
- **A Markdown library.** Rejected: the app's own parser already covers what the Herder writes
  (lists, tables, code, links) and never produces HTML.
- **Open any file 打开 points at.** Rejected: a message could name a script or an app; only viewers
  open, the rest is shown in Finder.

## Consequences

- Replies read like the Herder's Feishu messages; generated UI (ADR 0074) builds on this panel.
- The owner can open a task's result file from the pet in one click.
- Old replies with leaked tags show without them; the model no longer sees tags on its own words.

## Tests

- `apps/desktop/test/pet-state.test.ts` (folding, time lines, task events, status line), `apps/desktop/test/open-file.test.ts` (what 打开 opens or only shows),
  `apps/desktop/test/herd-ui-state.test.ts` (every long reply folds, by words or drawn height, not
  while its answers wait),
  `packages/herder/test/context.test.ts` (no tags on the Herder's own words, broken tag lines
  removed), `packages/host/test/pet.test.ts` (history without tags).
