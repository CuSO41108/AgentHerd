# ADR 0070: A desktop pet that says what Feishu says and takes answers

- Status: Accepted
- Date: 2026-11-17
- Changes: the local API no longer only reads items (spec 02 §4): the pet can press a card's
  button for the owner

## Context

- The owner asked for a floating window on the desktop, "like a pet": not only in Feishu, the
  owner should be able to talk to the Herder from the desktop and approve from there.
- Asked what it should be (m19718 era), the owner chose: talk to the Herder, see what is
  going on, approve directly; always there, foldable into a small dot. The chat panel of a first
  mock was "too big": only a small bubble.
- Notifications go to **both** the pet and Feishu ("都发").
- Look: Q-version figures, a few simple motions "like the DSH whale pet"
  (`dsh-plugin-whale-pet`: six states, one picture each, CSS motion, fixed lines, no model).
  The owner picked the two community figures of DeepSeek (大肥鱼) and Claude (Claude 娘) and left
  a default figure of our own for later ("默认形象再说吧，先把这两个放进去").
- The only Q-version art with both figures in one style is
  [savanna0425/llm-pet](https://github.com/savanna0425/llm-pet) (Codex pet sprite sheets). Its
  notice: art by Bilibili artist ZipZipPipe, credit the artist, **no commercial use**. The DSH
  whale's art may not be taken out of that plugin.

## Decision

1. **A tee in front of the channel.** The host wraps the Feishu channel in `PetFeed`
   (`packages/host/src/pet.ts`). Every view still goes to Feishu unchanged; the pet sees the same
   views. It keeps the latest line (Herder text, task progress, report, error, question) and the
   cards that wait for the owner (approval cards, asks, offers with buttons), and drops a card
   when its Feishu card is closed or updated without buttons. The board and relay cards are not
   shown. Nothing is stored: after a restart the pet starts empty.
2. **Answers go in as the owner's own.** `petPress(target, action)` delivers
   `{kind: "action", target, action, from: ownerId}` and `petSay(text)` delivers
   `{kind: "message", text, from: ownerId}` to the herd, exactly what a press or a message in
   Feishu delivers. So the inbox, asks, offers and the Herder need no change, and the Feishu card
   closes too. A typed message is also posted to the chat as 「（在桌宠里说）…」, so the Feishu
   conversation still reads in order. A press on a card that is no longer open is refused
   ("这件事已经处理过了"); with no channel connected, both are refused.
3. **Mood from state, not from a model.** The pet's mood follows the host: something waits for
   the owner → waiting; a report or error just came → celebrate or error for 6 s; a task is
   queued or working → working; nothing for 2 minutes or no host → sleeping; else resting. Its
   own words are a few fixed lines (开工啦！, 我先眯一会儿…); everything else it says is the text
   AgentHerd sent, cut to 90 characters. No model calls.
4. **Six frames, CSS motion.** Each figure is one strip of six 192×208 frames
   (resting, working, waiting, celebrate, error, sleeping) cut from llm-pet's chibi sheets
   (`apps/desktop/src/renderer/src/pet/figures/`), with a small CSS motion per mood (breathe,
   sway, tilt, hop, shake, slow breathe), zZ when sleeping and sparkles when cheering.
   `prefers-reduced-motion` stops the motion.
5. **The window.** A frameless, transparent, always-on-top window (`pet.html`,
   `apps/desktop/src/main/pet-window.ts`), on all spaces, not in the task bar, sized to the pet
   and growing up and left when the bubble opens. Drag moves it (the corner is saved); a click
   opens the bubble with an input line and 打开 App; the small – button folds it into a round dot
   with a red count of open cards. The main window still decides when the app quits; the dock
   icon brings the main window back.
6. **Settings.** 设置 → 桌宠: 显示桌宠 (on by default) and 形象 (大肥鱼 default, Claude 娘), saved
   in `config.json` as `pet: {on, figure}`. The figure credit is shown under the choice.
7. **License of the art.** The two strips are not under AgentHerd's MIT license:
   `figures/NOTICE.md` credits ZipZipPipe and llm-pet and says no commercial use; the README says
   the same. A figure of our own, free to ship, comes later.

## Alternatives

- **A chat panel in the pet** — the owner found it too big; the bubble shows one line and the
  open card, Feishu and the app keep the history.
- **The pet calls a model for its own lines (Claude Code `/buddy`)** — costs a call per line and
  can say things AgentHerd did not; fixed lines and AgentHerd's own text are enough.
- **A host API that decides items directly** — would duplicate the inbox's rules (owner check,
  batch cards, asks, offers); delivering the same inbound as Feishu reuses all of them.
- **Codex pet sheets with full animations (8 frames per row)** — more motion than the owner asked
  for, and the sheets are 2 MB each; six still frames are 0.45 MB together.
- **The DSH whale** — its art may not be extracted from that plugin.

## Consequences

- The local API can now answer cards (`petPress`) and send messages (`petSay`), only as the bound
  owner and only through the inbox's rules; anyone who can reach the socket (mode 600) could
  already change settings.
- What the owner types in the pet shows in Feishu with a 「（在桌宠里说）」 prefix.
- After a restart the pet does not know older open cards until they change; Feishu still has
  them.
- The bundled art cannot be shipped commercially as it is.

Tests: `packages/host/test/pet.test.ts` (feed, inbound, stale buttons, E2E-PET-APPROVE),
`packages/host/test/host.test.ts` (settings, `petSay`), `apps/desktop/test/pet-state.test.ts`
(mood and lines).
