// 信箱 (ADR 0099): what comes in from outside before the Herder sees it. Each source is looked at
// by code on its own clock; only new letters reach the Herder, which tells the owner, keeps them
// for the morning digest, or just notes them. Sources are added by telling the Herder, or here.

import type {
  Letter,
  MailboxDraft,
  MailboxKind,
  MailboxLetterView,
  MailboxSource,
  MailboxView,
} from "@agentherd/host/api";
import {
  AlarmClock,
  ExternalLink,
  Flame,
  FlaskConical,
  GitBranch,
  Inbox,
  type LucideIcon,
  Plus,
  RefreshCw,
  Rss,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Group,
  IconTile,
  inputClass,
  Section,
  Segmented,
  Switch,
} from "../components/ui";
import {
  draftProblem,
  everyText,
  fateCounts,
  fateOf,
  filterLetters,
  KIND_HINTS,
  KIND_LABELS,
  KIND_ORDER,
  LETTER_FILTERS,
  type LetterFilter,
  sourceLine,
  sourceState,
  suggestedName,
  whatText,
  whenText,
} from "../mailbox";
import { call, useApp } from "../store";

const ICONS: Record<MailboxKind, LucideIcon> = {
  github: GitBranch,
  rss: Rss,
  hn: Flame,
  script: SquareTerminal,
  timer: AlarmClock,
};

/** Letters arrive on the host's clock; look again now and then besides the events. */
const REFRESH_MS = 30_000;

function SourceRow({
  source,
  selected,
  onSelect,
  onView,
}: {
  source: MailboxSource;
  selected: boolean;
  onSelect: () => void;
  onView: (v: MailboxView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const Icon = ICONS[source.kind];
  const state = sourceState(source);
  const run = async (action: () => Promise<MailboxView | undefined>) => {
    setBusy(true);
    const v = await action();
    setBusy(false);
    if (v !== undefined) onView(v);
  };
  const remove = () => {
    if (!window.confirm(`删掉来源「${source.name}」？它的信也一起删掉，主管不会再看这里。`)) return;
    void run(() => call((h) => h.mailboxRemove(source.id)));
  };
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${selected ? "bg-accent-soft/40" : ""}`}>
      <IconTile tone={state.tone === "red" ? "red" : source.paused ? "gray" : "blue"}>
        <Icon size={14} />
      </IconTile>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{source.name}</span>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        <div className="mt-0.5 truncate text-ink-muted text-sm" title={whatText(source)}>
          {KIND_LABELS[source.kind]} · {whatText(source)}
        </div>
        {source.note !== "" && source.kind !== "timer" && (
          <div className="mt-0.5 truncate text-ink-2 text-sm" title={source.note}>
            给主管的话：{source.note}
          </div>
        )}
        <div className="mt-0.5 text-ink-dim text-xs">{sourceLine(source)}</div>
        {source.lastError !== undefined && source.fails > 0 && (
          <div className="mt-1 text-danger-text text-sm">{source.lastError}</div>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          aria-label="现在看一次"
          title="现在看一次"
          disabled={busy || source.paused}
          onClick={() => void run(() => call((h) => h.mailboxRun(source.id)))}
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        </Button>
        <Switch
          label={source.paused ? "恢复" : "停下"}
          checked={!source.paused}
          disabled={busy}
          onChange={(on) => void run(() => call((h) => h.mailboxSet(source.id, { paused: !on })))}
        />
        <Button variant="ghost" size="sm" aria-label="删除" disabled={busy} onClick={remove}>
          <Trash2 size={13} />
        </Button>
      </div>
    </div>
  );
}

function LetterRow({ letter }: { letter: MailboxLetterView }) {
  const fate = fateOf(letter);
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {letter.link === undefined ? (
            <span className="truncate font-medium text-ink">{letter.title}</span>
          ) : (
            <a
              href={letter.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-ink hover:underline"
              title={letter.link}
            >
              <span className="truncate">{letter.title}</span>
              <ExternalLink size={11} className="shrink-0 text-ink-dim" />
            </a>
          )}
        </div>
        <div className="mt-0.5 text-ink-muted text-sm">
          {letter.source} · {whenText(letter.at)}
        </div>
        {letter.why !== undefined && letter.why !== "" && (
          <div className="mt-0.5 text-ink-2 text-sm">主管：{letter.why}</div>
        )}
      </div>
      <Badge tone={fate.tone}>{fate.label}</Badge>
    </div>
  );
}

const EMPTY_DRAFT: MailboxDraft = {
  kind: "github",
  name: "",
  note: "",
  what: ["issues", "releases"],
};

function AddDialog({
  view,
  onClose,
  onView,
}: {
  view: MailboxView;
  onClose: () => void;
  onView: (v: MailboxView) => void;
}) {
  const [draft, setDraft] = useState<MailboxDraft>(EMPTY_DRAFT);
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState<"try" | "add" | undefined>();
  const [tried, setTried] = useState<Letter[] | undefined>();
  const set = (patch: Partial<MailboxDraft>) => {
    setTried(undefined);
    setDraft((d) => {
      const next = { ...d, ...patch };
      return named ? next : { ...next, name: suggestedName(next) };
    });
  };
  const problem = draftProblem(draft, view);
  const every = view.every[draft.kind];
  const tryIt = async () => {
    setBusy("try");
    const letters = await call((h) => h.mailboxTry(draft));
    setBusy(undefined);
    if (letters !== undefined) setTried(letters);
  };
  const add = async () => {
    setBusy("add");
    const v = await call((h) => h.mailboxAdd(draft));
    setBusy(undefined);
    if (v !== undefined) {
      onView(v);
      onClose();
    }
  };
  const what = draft.what ?? ["issues", "releases"];
  const toggleWhat = (w: "issues" | "prs" | "releases") =>
    set({ what: what.includes(w) ? what.filter((x) => x !== w) : [...what, w] });
  return (
    <Modal
      title="加一个来源"
      description="代码按时去看，只有新东西才交给主管"
      onClose={onClose}
      wide
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ink-muted text-sm">{problem ?? ""}</span>
          {draft.kind !== "timer" && (
            <Button
              disabled={problem !== undefined || busy !== undefined}
              onClick={() => void tryIt()}
            >
              <FlaskConical size={13} />
              {busy === "try" ? "在看…" : "先试一次"}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={problem !== undefined || busy !== undefined}
            onClick={() => void add()}
          >
            {busy === "add" ? "在加…" : "添加"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label="来源种类"
          options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          value={draft.kind}
          onChange={(kind) =>
            set({ kind, ...(kind === "github" ? { what: ["issues", "releases"] } : {}) })
          }
        />
        <p className="-mt-2 text-ink-muted text-sm">{KIND_HINTS[draft.kind]}</p>
        {draft.kind === "github" && (
          <>
            <Field label="仓库" hint="owner/name，或者仓库的网址">
              <input
                className={inputClass}
                placeholder="openai/codex"
                value={draft.repo ?? ""}
                onChange={(e) => set({ repo: e.target.value })}
              />
            </Field>
            <div className="flex items-center gap-4 text-md">
              {(
                [
                  ["issues", "新 issue"],
                  ["prs", "新 PR"],
                  ["releases", "发布"],
                ] as const
              ).map(([w, label]) => (
                <label key={w} className="flex items-center gap-1.5 text-ink-2">
                  <input
                    type="checkbox"
                    checked={what.includes(w)}
                    onChange={() => toggleWhat(w)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </>
        )}
        {draft.kind === "rss" && (
          <Field label="订阅地址">
            <input
              className={inputClass}
              placeholder="https://example.com/feed.xml"
              value={draft.url ?? ""}
              onChange={(e) => set({ url: e.target.value })}
            />
          </Field>
        )}
        {(draft.kind === "github" || draft.kind === "rss" || draft.kind === "hn") && (
          <Field
            label={draft.kind === "hn" ? "要搜的词" : "只要带这些词的（可以不填）"}
            hint={draft.kind === "hn" ? undefined : "用逗号隔开，带其中一个就算"}
          >
            <input
              className={inputClass}
              placeholder={draft.kind === "hn" ? "agent memory" : "crash, macOS"}
              value={draft.words ?? ""}
              onChange={(e) => set({ words: e.target.value })}
            />
          </Field>
        )}
        {draft.kind === "hn" && (
          <Field label="至少多少分（可以不填）">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={draft.points ?? ""}
              onChange={(e) =>
                set({ points: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </Field>
        )}
        {draft.kind === "script" && (
          <>
            <Field
              label="命令"
              hint='从标准输入读 {"state": 上次留下的}，打印 {"letters":[{"id","title","body","link"}],"state":…}；没有新东西就打印空列表'
            >
              <input
                className={`${inputClass} font-mono`}
                placeholder="python3 ~/bin/check-prices.py"
                value={draft.command ?? ""}
                onChange={(e) => set({ command: e.target.value })}
              />
            </Field>
            <Field label="在哪个文件夹运行（可以不填）">
              <input
                className={inputClass}
                placeholder="~"
                value={draft.cwd ?? ""}
                onChange={(e) => set({ cwd: e.target.value === "" ? undefined : e.target.value })}
              />
            </Field>
          </>
        )}
        <Field
          label={draft.kind === "timer" ? "到点要主管做什么" : "给主管的话"}
          hint={
            draft.kind === "timer"
              ? "主管每次都会照这句话去做，每次都会用一次模型"
              : "你在意这里的什么，主管每封信都会拿这句话来判断"
          }
        >
          <textarea
            className={`${inputClass} min-h-16`}
            placeholder={
              draft.kind === "timer"
                ? "看看昨晚的任务有没有卡住的"
                : "macOS 上崩溃的问题马上告诉我，其他的早上汇总"
            }
            value={draft.note ?? ""}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="名字">
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => {
                setNamed(true);
                setDraft((d) => ({ ...d, name: e.target.value }));
              }}
            />
          </Field>
          <Field
            label="多久看一次（分钟）"
            hint={`最快${everyText(every.min)}，默认${everyText(every.default)}`}
          >
            <input
              className={inputClass}
              type="number"
              min={every.min}
              placeholder={String(every.default)}
              value={draft.everyMinutes ?? ""}
              onChange={(e) =>
                set({ everyMinutes: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </Field>
        </div>
        {tried !== undefined && (
          <div className="rounded-md bg-control-hover px-3 py-2.5 text-sm">
            {tried.length === 0 ? (
              <span className="text-ink-2">能看到，现在没有东西。</span>
            ) : (
              <>
                <div className="mb-1 text-ink-2">
                  能看到，现在有 {tried.length} 条。加上以后第一次只记下这些，之后来的才会交给主管：
                </div>
                <ul className="flex flex-col gap-0.5 text-ink-muted">
                  {tried.slice(0, 6).map((l) => (
                    <li key={l.id} className="truncate">
                      · {l.title}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function MailboxPage() {
  const view = useApp((s) => s.mailbox);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<LetterFilter>("all");
  const [sourceId, setSourceId] = useState<string | undefined>();
  const setView = useCallback((v: MailboxView) => useApp.setState({ mailbox: v }), []);
  useEffect(() => {
    const load = () => void call((h) => h.mailbox()).then((v) => v !== undefined && setView(v));
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [setView]);
  const shown = useMemo(
    () => filterLetters(view?.letters ?? [], filter, sourceId),
    [view, filter, sourceId],
  );
  const counts = useMemo(
    () => fateCounts(filterLetters(view?.letters ?? [], "all", sourceId)),
    [view, sourceId],
  );
  if (view === undefined) return null;
  if (!view.on) {
    return (
      <Group>
        <EmptyState
          icon={<Inbox size={18} />}
          text="连上飞书、AgentHerd 开始工作后，就能在这里加来源，看主管怎么处理每一封信。"
        />
      </Group>
    );
  }
  const selected = view.sources.find((s) => s.id === sourceId);
  return (
    <div className="flex flex-col gap-7">
      <Section
        title="来源"
        hint={`代码按时去看，第一次只记下已有的，之后只把新的交给主管。主管觉得要紧的马上告诉你，其余的每天 ${view.digestHour} 点汇总一次。`}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={13} />
            加一个来源
          </Button>
        }
      >
        <Group>
          {view.sources.length === 0 ? (
            <EmptyState
              icon={<Inbox size={18} />}
              text="还没有来源。跟主管说「帮我盯一下 openai/codex 的新 issue」，或者点「加一个来源」。"
            />
          ) : (
            view.sources.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                selected={s.id === sourceId}
                onSelect={() => setSourceId(s.id === sourceId ? undefined : s.id)}
                onView={setView}
              />
            ))
          )}
        </Group>
      </Section>
      <Section
        title={selected === undefined ? "信" : `信 · ${selected.name}`}
        hint="每封信主管怎么处理的、为什么"
        actions={
          selected === undefined ? undefined : (
            <Button variant="ghost" size="sm" onClick={() => setSourceId(undefined)}>
              看全部来源
            </Button>
          )
        }
      >
        <Segmented
          label="按处理结果看"
          options={LETTER_FILTERS.map((f) => ({
            value: f.value,
            label: `${f.label} ${counts[f.value]}`,
          }))}
          value={filter}
          onChange={setFilter}
        />
        <Group>
          {shown.length === 0 ? (
            <EmptyState
              icon={<Inbox size={18} />}
              text={
                view.letters.length === 0
                  ? "还没有信。来源第一次只记下已有的，之后来了新的才会出现在这里。"
                  : "这一类还没有信。"
              }
            />
          ) : (
            shown.map((l) => <LetterRow key={l.id} letter={l} />)
          )}
        </Group>
      </Section>
      {adding && <AddDialog view={view} onClose={() => setAdding(false)} onView={setView} />}
    </div>
  );
}
