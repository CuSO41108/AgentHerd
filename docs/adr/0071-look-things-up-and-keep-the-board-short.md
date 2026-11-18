# ADR 0071: The Herder looks things up itself, the board keeps a day, and follow-ups stay in their task

- Status: Accepted
- Date: 2026-11-18
- Changes: [0019](0019-relay-verbatim-board-and-reports.md) (the board lists every task up to 20
  rows) and the Herder's tools (spec 04 §1)

## Context

- The owner, looking at the board on 2026-11-18: 「我发现我们的任务的话，是不是开的太多了呀？你看看
  任务看板，越累计越多了」 (m21012).
- That morning's board: eight tasks, seven of them done. Four were started within 15 minutes for
  one line of research each (「superpowers：看项目现状」, 「搜索 GitHub 上的 magpie」, 「整理值得关注的
  X AI 博主」) and one, 「下载并启动 yetone/magpie」, was the next step of the magpie search but
  opened a task of its own.
- Three causes:
  1. The Herder had no way to read the web. Even 「magpie 多少 star」 needed a task: an agent, a
     folder, a model, and a card on the board when it ended.
  2. The board never dropped a finished task: `boardView` sorted every task and kept 20 rows, so
     done tasks from a week ago stayed pinned in Feishu.
  3. The prompt said "start a new task only for new work", but "download what the search found"
     looked like new work to the model. With the old prompt, deepseek-flash given 「把 magpie
     下载下来跑一下」 and the finished search task asked which magpie or did nothing (2 of 2 runs).
- Agents in tasks had no search engine either: the research task searched by `curl` against
  hn.algolia, arXiv and single sites.
- The owner agreed to the plan (m21087) with 「可以的」 (m21088).

## Decision

1. **Two read-only tools for the Herder**, `web_search` and `web_read`
   (`packages/herder/src/lookup.ts`):
   - `web_search(query, source?, limit?)` lists titles, links and snippets. Web results come from
     DuckDuckGo's HTML page, then Bing when DuckDuckGo turns the request away or finds nothing;
     ads are left out and the engines' click links are turned back into the real links.
     `source: "github"` searches GitHub repositories (stars, forks, language, last push).
   - `web_read(url, maxChars?)` reads one page as text: title, then the body without scripts,
     styles, menus and footers; 8,000 characters by default, at most 30,000, and it says how
     much is left. A github.com repository link gives the repository's facts from the GitHub API
     instead of the page: stars, forks, open issues and pull requests, language, license, dates,
     the latest release and the start of the README.
   - **Only reading.** GET requests without cookies; never a login link. Only public hosts: the
     host name is resolved and refused when it or any redirect points at this computer or a
     private network (`checkPublic`), so a link cannot reach `127.0.0.1:18060` or a router.
     15 s per request, 2 MB per response, 5 redirects. A file that is not text is named, not read:
     downloading is a task.
   - **GitHub's limit.** Without a token GitHub allows 60 reads an hour from an address, and this
     Mac had used them up. The host passes the owner's own `gh auth token` when `gh` is signed in;
     it is sent only to `api.github.com`. Without it the tools still work, with GitHub's limit.
   - The prompt: a quick question about the web is answered with these tools, a few calls, with
     the links used, never claiming what was not read; many pages or steps, files, downloads,
     installing or running anything is a task.
   - A turn that only looked things up changed nothing outside, so it is retried after a
     connection error like a turn that only read its context (`LOOKUP_TOOL_NAMES`).
2. **The board keeps open tasks and a day of ended ones.** `boardView(tasks, now)` shows every
   task that is queued, working, stuck or waiting for the owner, and a done or failed task only
   when it changed in the last 24 hours (`BOARD_ENDED_KEEP_MS`); then 20 rows at most, as before.
   Older tasks are only in the app's 已结束 list. Nothing is deleted: the Herder still finds them
   with `task_search` and continues them with `session_prompt`.
3. **The next step of a recent task is more on that task.** The prompt now names it: a task found
   a repository and the owner wants it downloaded or run, a task wrote a draft and the owner wants
   it changed: that is `session_prompt` to that task, not a new one. With the new prompt the same
   two runs of deepseek-flash sent 「把 magpie 下载下来跑一下」 to the finished search task, which
   AgentHerd starts again in its folder.

## Alternatives

- **A search API** (Brave, Bing, Tavily, Serper): better results, but each needs a key and an
  account from the owner. Brave's page answers `curl` but turns Node's fetch away (429); the HTML
  pages of DuckDuckGo and Bing answer both. Kept simple; a key-based engine can be added later.
- **Agents get the tools too** (an MCP server for tasks): useful, but tasks run shell commands and
  can already fetch pages; not needed for fewer tasks.
- **Delete or archive old tasks:** they are history the Herder and the app use. Only the board
  shows fewer.
- **The board shows only open tasks:** a task that just finished would vanish before the owner
  saw it there. A day is long enough to notice.

## Consequences

- Simple questions are answered in seconds without a task: in the smoke test deepseek-flash
  answered 「yetone/magpie 现在多少 star，最新版本是哪个？」 with one `web_read` call (4–7 s).
- Search pages change their markup; when both engines fail the tool says so
  (`the web search did not work (…)`) and the Herder can start a task. The parsers are covered by
  tests with saved page snippets.
- A pinned board drops an old task at its next update, not at the exact hour.

## Tests

- `packages/herder/test/lookup.test.ts`: private and local addresses, every redirect checked,
  DuckDuckGo and Bing parsing (ads, click links), Bing after DuckDuckGo, "nothing found" and
  errors, GitHub search with the token only to `api.github.com`, pages to text, repository facts
  from the API and the page when the API fails, files that are not text.
- `packages/herder/test/herder.test.ts`: a web question answered with `web_search`, no task
  started, retried after a connection error.
- `packages/core/test/board.test.ts`: open tasks of any age, ended tasks only within 24 hours.
