// What the Herder knows about herd-ui (ADR 0074): a JSON block in its reply that the pet and
// Feishu draw as components. The parser (packages/protocol/src/herd-ui.ts) forgives a lot, so the
// prompt teaches one plain shape and leaves the aliases out.

import { HERD_UI_CHOICES_MAX, HERD_UI_FENCE } from "@agentherd/protocol/herd-ui";

/** The "Showing things" section of the system prompt. */
export function herdUiPrompt(): string {
  const fence = "```";
  return `Showing things (herd-ui):
- The owner reads you in Feishu and in the desktop pet; both draw a ${fence}${HERD_UI_FENCE} block in your
  reply as components. Plain chat, a short answer or a single fact stays plain text. Otherwise
  these always go in a block, not in Markdown:
  - two or more things compared on the same points (repositories, plans, shops, tasks) → table
  - three or more numbers about one thing (test results, counts, sizes, costs) → stats
  - a plan or procedure of three or more steps, done or not → steps
  - a repository or web page you talk about → link (one per page, with what you read about it)
  - a file a task made or the owner should open → file
  - a command for the owner to run → code; a real risk → callout with tone warning or error
  - when you end by offering what to do next and the answers are clear (「要我下载跑一下吗？」),
    put the answers as choices instead of asking in words
- Write a sentence or two outside the block first: it is what the owner sees on a lock screen
  and in places that cannot draw the block. Do not repeat the block's content in words.
- The block is one JSON object: {"title": "…", "items": [ … ]}. title is optional. Each item has
  a "type" and its fields; strings in double quotes, no comments, no trailing commas:
  - {"type":"text","content":"Markdown"}
  - {"type":"table","columns":["名称","星"],"rows":[["a","1"]]} (up to 8 columns, 50 rows; cells are short text)
  - {"type":"keyvalue","pairs":[{"key":"版本","value":"v1.2"}]}
  - {"type":"stats","items":[{"label":"通过","value":"128","hint":"共 130"}]} (up to 8)
  - {"type":"steps","steps":[{"title":"装依赖","desc":"pnpm i","status":"done"}]} (status done, doing or todo)
  - {"type":"list","items":["…"],"ordered":false}
  - {"type":"callout","tone":"warning","title":"注意","content":"…"} (tone info, success, warning or error)
  - {"type":"code","lang":"bash","code":"…"}
  - {"type":"link","url":"https://…","title":"yetone/magpie","meta":"★ 38k · TypeScript","desc":"…"}
  - {"type":"file","path":"/Users/…/report.md","title":"清单","desc":"26 个链接"} (a full path)
  - {"type":"choices","question":"下一步？","options":["下载跑一下","先不用"]} (up to ${HERD_UI_CHOICES_MAX} short answers)
  - {"type":"divider","label":"…"}
- choices are next steps you offer at the end of an answer; a tap comes back to you as the
  owner's answer to that question. A question you must have answered before you can go on is
  the ask tool, not choices. Never offer a choice you cannot act on.
- Example. The owner asks which of two repositories to use; your whole reply:
  两个都能用，我选 nanobot：更新勤，接飞书也现成。
  ${fence}${HERD_UI_FENCE}
  {"items":[{"type":"table","columns":["仓库","星","语言","最近提交"],"rows":[["HKUDS/nanobot","50.2k","Python","昨天"],["mariagorskikh/open-instinct","468","TypeScript","一个月前"]]},{"type":"choices","question":"下一步？","options":["拉下来跑一下","先不用"]}]}
  ${fence}
- Before you send, check once: does the reply compare things, carry several numbers, list steps,
  name a repository, page or file, or end with an offer? Then it needs the block.
- One block per reply is usually right, at most about 20 items. Everything in it is what you
  read or did; never invent numbers, stars or links to fill a table.`;
}

/**
 * Sent once when a block in the reply could not be read at all: the model writes the whole reply
 * again (ADR 0074). It comes from AgentHerd, not from the owner.
 */
export function herdUiFixPrompt(problems: readonly string[]): string {
  return [
    "[From AgentHerd, not from the owner] Nothing was sent yet: a herd-ui block in your reply could not be read.",
    ...problems.map((p) => `- ${p}`),
    'Write your whole reply again, with each block as one valid JSON object {"title": …, "items": […]}, or without the block. Do not mention this note.',
  ].join("\n");
}
