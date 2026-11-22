// What the 信箱 page shows (ADR 0099), kept apart from the components so it can be tested.

import type {
  MailboxDraft,
  MailboxKind,
  MailboxLetterView,
  MailboxSource,
  MailboxView,
} from "@agentherd/host/api";
import type { Tone } from "./components/ui";

export const KIND_LABELS: Record<MailboxKind, string> = {
  github: "GitHub 仓库",
  rss: "RSS 订阅",
  hn: "Hacker News",
  script: "自己的脚本",
  timer: "定时提醒",
};

export const KIND_HINTS: Record<MailboxKind, string> = {
  github: "仓库的新 issue、PR 和发布；用你登录的 gh 去看",
  rss: "博客、新闻站的 RSS 或 Atom 订阅",
  hn: "Hacker News 上带这些词的新帖子",
  script: "任何语言的命令：读进上次留下的状态，打印新信件和新状态",
  timer: "到点给主管一封信，主管照你写的话去做",
};

export const KIND_ORDER: readonly MailboxKind[] = ["github", "rss", "hn", "script", "timer"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 「今天 14:05」「昨天 09:00」「11-19 21:31」. */
export function whenText(at: string | undefined, now: Date = new Date()): string {
  if (at === undefined) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return `今天 ${clock}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(d) === day(yesterday)) return `昨天 ${clock}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}

/** 「每 10 分钟」「每 2 小时」「每天」. */
export function everyText(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "每天" : `每 ${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时`;
  return `每 ${minutes} 分钟`;
}

/** What the source looks at, in one short line. */
export function whatText(s: MailboxSource): string {
  const c = s.config;
  const words = Array.isArray(c.words) ? (c.words as string[]).join("、") : "";
  if (s.kind === "github") {
    const what = Array.isArray(c.what) ? (c.what as string[]) : ["issues", "releases"];
    const names = what.map((w) => ({ issues: "issue", prs: "PR", releases: "发布" })[w] ?? w);
    return `${String(c.repo ?? "")} 的新 ${names.join("、")}${words === "" ? "" : `，带「${words}」`}`;
  }
  if (s.kind === "rss") {
    return `${String(c.url ?? "")}${words === "" ? "" : `，带「${words}」`}`;
  }
  if (s.kind === "hn") {
    const points = typeof c.points === "number" && c.points > 0 ? `，${c.points} 分以上` : "";
    return `「${String(c.words ?? "")}」${points}`;
  }
  if (s.kind === "script") return String(c.command ?? "");
  return s.note;
}

export interface SourceState {
  label: string;
  tone: Tone;
}

export function sourceState(s: MailboxSource): SourceState {
  if (s.paused) return { label: "停着", tone: "gray" };
  if (s.lastError !== undefined && s.fails > 0) {
    return { label: s.fails >= 3 ? `连着 ${s.fails} 次没取到` : "上次没取到", tone: "red" };
  }
  if (!s.started) return { label: "第一次还没看", tone: "amber" };
  return { label: "正常", tone: "green" };
}

/** 「上次 今天 14:05 · 来了 3 封」 */
export function sourceLine(s: MailboxSource, now: Date = new Date()): string {
  const parts = [everyText(s.everyMinutes)];
  if (s.lastRunAt !== undefined) parts.push(`上次 ${whenText(s.lastRunAt, now)}`);
  parts.push(s.letters === 0 ? "还没来过信" : `来了 ${s.letters} 封`);
  if (s.by === "herder") parts.push("主管加的");
  return parts.join(" · ");
}

export type LetterFilter = "all" | "now" | "digest" | "noted" | "waiting";

export const LETTER_FILTERS: readonly { value: LetterFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "now", label: "告诉你了" },
  { value: "digest", label: "留到汇总" },
  { value: "noted", label: "记下了" },
  { value: "waiting", label: "等主管看" },
];

export interface FateView {
  label: string;
  tone: Tone;
}

/** What became of a letter: told now, kept for the morning digest, only noted, or still waiting. */
export function fateOf(l: MailboxLetterView): FateView {
  if (l.fate === "now") return { label: "告诉你了", tone: "blue" };
  if (l.fate === "digest") {
    return l.digestedAt === undefined
      ? { label: "留到汇总", tone: "amber" }
      : { label: "已汇总", tone: "green" };
  }
  if (l.fate === "noted") return { label: "记下了", tone: "gray" };
  if (l.sentAt !== undefined) return { label: "主管在看", tone: "amber" };
  return { label: "等主管看", tone: "gray" };
}

export function filterLetters(
  letters: readonly MailboxLetterView[],
  filter: LetterFilter,
  sourceId?: string,
): MailboxLetterView[] {
  return letters.filter((l) => {
    if (sourceId !== undefined && l.sourceId !== sourceId) return false;
    if (filter === "all") return true;
    if (filter === "waiting") return l.fate === undefined;
    return l.fate === filter;
  });
}

export function fateCounts(letters: readonly MailboxLetterView[]): Record<LetterFilter, number> {
  const counts: Record<LetterFilter, number> = { all: 0, now: 0, digest: 0, noted: 0, waiting: 0 };
  for (const l of letters) {
    counts.all += 1;
    counts[l.fate ?? "waiting"] += 1;
  }
  return counts;
}

/** Why a draft cannot be added yet, in the owner's words; undefined when it can. */
export function draftProblem(d: MailboxDraft, view?: MailboxView): string | undefined {
  if (d.name.trim() === "") return "起个名字";
  if (d.kind === "github") {
    const repo = (d.repo ?? "")
      .trim()
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\/$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return "仓库写成 owner/name，比如 openai/codex";
    if (d.what !== undefined && d.what.length === 0) return "至少选一样：issue、PR 或发布";
  }
  if (d.kind === "rss" && !/^https?:\/\/\S+$/.test((d.url ?? "").trim()))
    return "填订阅的地址（http 开头）";
  if (d.kind === "hn" && (d.words ?? "").trim() === "") return "填要搜的词";
  if (d.kind === "script" && (d.command ?? "").trim() === "") return "填要运行的命令";
  if (d.kind === "timer" && (d.note ?? "").trim() === "") return "写下到点要主管做什么";
  const every = view?.every[d.kind];
  if (d.everyMinutes !== undefined && every !== undefined && d.everyMinutes < every.min) {
    return `${KIND_LABELS[d.kind]}最快${everyText(every.min)}看一次`;
  }
  return undefined;
}

/** The name a new source starts with, from what was filled in. */
export function suggestedName(d: MailboxDraft): string {
  if (d.kind === "github") {
    const repo = (d.repo ?? "")
      .trim()
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\/$/, "");
    return repo.split("/")[1] ?? "";
  }
  if (d.kind === "rss") {
    try {
      return new URL((d.url ?? "").trim()).host.replace(/^www\./, "");
    } catch {
      return "";
    }
  }
  if (d.kind === "hn") return (d.words ?? "").trim() === "" ? "" : `HN：${(d.words ?? "").trim()}`;
  return "";
}
