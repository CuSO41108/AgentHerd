# ADR 0075: The Herder shows pictures in the pet and in Feishu

- Status: Accepted
- Date: 2026-11-18
- Changes: [0074](0074-the-herder-draws-with-herd-ui-blocks.md) (a thirteenth component, `image`)

## Context

- A task that needed the owner to sign in to Feishu mail saved a QR code to
  `/tmp/lark-mail-auth.png`; the Herder passed on 「二维码在 /tmp/lark-mail-auth.png」 and the owner
  asked 「现在咋显示不了图片啊」 (m23087).
- AgentHerd could take pictures from the owner (Feishu image messages) but never send one: the
  pet drew only text and components, the Feishu channel only cards without images. Since
  [ADR 0073](0073-the-pets-conversation-looks-like-a-chat.md)'s change of the same day a path in
  plain words is plain text, so not even a 打开 button was left.
- Proposed (m23103): pictures inline in the pet, uploaded into the Feishu card, and a prompt rule.
  The owner: 「都改」 (m23104).
- Found on the way: since ADR 0074, a task result the Herder put into words with a block it had
  to normalize (any spacing in the JSON) was thrown away and the agent's own words went out
  instead, because the voice path took any change of the reply for tool calls written as text.

## Decision

1. **An `image` item.** herd-ui gets `{"type":"image","path","title"?,"desc"?}`: a full path (`/…`
   or `~/…`) to a png, jpg, gif or webp on this computer. The parser forgives as for other items
   (`qrcode`, `screenshot`, `img`… are read as `image`; `src`, `url`, `alt`, `caption` as its
   fields). A `file` item whose path is a picture becomes an `image`; an `image` that is not a
   picture becomes a `file`; an `image` with a web address becomes a `link` (neither drawing
   fetches from the web). At most 4 pictures a block, the rest as files. In plain text it is
   `🖼️ title：path`.
2. **The pet draws it, main reads it.** The pet's page cannot read files and its policy allows
   only `data:` images. It asks main (`pet:read-image`, only from the pet's own window); main
   reads the file only if the path is a full path with a picture's extension, a regular file of
   1 byte to 10 MB, and its first bytes are that picture, and answers a data URL. The page draws
   it whole, as wide as the reply, at most 360 px high; a tap opens it in Preview. It is read
   again each time it is drawn, since a task may write a fresh code to the same path. If main
   will not read it, the pet shows it as a file named by its path.
3. **Feishu gets it uploaded.** Before a card with pictures is sent or updated, the channel reads
   each picture under the same checks (`readPicture`) and uploads it with `im/v1/images`
   (`image_type: message`), then draws an `img` element (`scale_type: fit_horizontal`, tap to
   enlarge) with its title and description in grey under it. The same bytes are uploaded once
   (kept by hash, the last 200). A picture that cannot be read or uploaded is named by its path
   in the card and not tried again for 10 minutes; the reason goes to the host log
   (`[feishu] picture … not shown in Feishu: …`). Uploading needs the app's `im:resource`
   permission: new apps ask for it at setup; an app made before must have it added in the Feishu
   developer console, or pictures stay paths. A card Feishu refuses is drawn the old way without
   pictures (ADR 0074).
4. **The Herder is told to.** "Showing things" says a picture on this computer the owner has to
   look at (a QR code, a screenshot, a chart saved as a picture) is an `image` item — also when a
   task's message only names its path and when the owner asks to see one — and that a sign-in
   link still goes in words next to it. The prompt for putting a task's result into words says
   the same for pictures the agent saved for the owner.
5. **A repaired block no longer loses a task's result.** The voice path now gives up only when
   the reply held tool calls written as text, not when its block was repaired.

Only pictures leave the computer this way: a path to anything else is never read for the pet or
uploaded to Feishu, so a reply cannot send the owner's other files out.

## Measured

deepseek-flash, the Herder's model, putting into words four task results and an owner message
(`packages/herder/test/eval-image.tmp.ts`, not kept): a QR code to sign in, a screenshot of a
started app, a cleanup whose only path is a log, and 「刚才任务说微信登录二维码在 /tmp/wechat-login.png，你给我看一下」.

| Prompt | QR code / screenshot shown | Owner asks to see one | A log shown as a picture |
| --- | --- | --- | --- |
| Rule only in "Showing things" | 0 of 4 | 0 of 2 | 0 of 2 |
| Also in the task-result prompt, voice fix | 6 of 6 | 0 of 3 | 0 of 3 |
| Also "no need to check it first" (final, 3 runs) | 6 of 6 | 3 of 3 | 0 of 3 |

The sign-in link stayed in words or a link item next to the QR code in every run.

## Alternatives

- **Send the picture as its own image message.** Feishu would show it, but apart from the words
  around it and out of order with the card; the pet would need a second kind of line. One card
  keeps the words and the picture together.
- **Let the pet load `file://` paths.** Would need the page's policy opened to the disk, for
  every reply; main reading only checked pictures keeps the page closed.
- **Pictures from the web.** Neither drawing fetches from the web: a link item opens it.

## Consequences

- Feishu messages with pictures take an upload first (a second or two); the same picture is not
  uploaded again.
- An owner whose app was made before this change has to add `im:resource` once; until then
  pictures show as paths and the host log says why.
- The system prompt grows by about 700 characters.

## Tests

- `packages/protocol/test/herd-ui.test.ts` ("pictures"): reading, aliases, file↔image, web
  addresses, the cap, plain text, `herdUiImages`.
- `packages/channel-feishu/test/herd-ui-image.test.ts`: upload and `img` element, one upload for
  the same picture, failure named by path and retried after the wait, unreadable files, reports,
  `readPicture` refusing scripts, fakes, empty and oversized files.
- `apps/desktop/test/open-file.test.ts`: `pictureToShow` and `pictureMime`.
- `packages/herder/test/herd-ui.test.ts`: the prompt teaches `image`; a task result with a
  repaired block is said, not dropped.
