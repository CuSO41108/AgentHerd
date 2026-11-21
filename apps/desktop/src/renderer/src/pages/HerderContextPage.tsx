// 主管 → 上下文 (ADR 0093): what the Herder's last request was made of, how its requests grew,
// what it folded, and the tokens its model counted. Layout after dsh-context's Context tab; the
// numbers come from the Herder's own context engine and from herd.db's herder_requests.

import type {
  HerderContextFold,
  HerderContextPart,
  HerderContextSnapshot,
  HerderContextView,
  HerderTrendPoint,
  HerderUsage,
} from "@agentherd/host/api";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, Group } from "../components/ui";
import {
  CONTEXT_PARTS,
  formatTokens,
  itemsOf,
  PART_COLORS,
  PART_HINTS,
  PART_LABELS,
  partsBySize,
  percent,
  timeOf,
} from "../herder-context";
import { host } from "../store";

const POLL_MS = 5000;

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Group>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-medium text-ink text-md">{title}</h3>
          {right !== undefined && <div className="text-ink-muted text-sm">{right}</div>}
        </div>
        {children}
      </div>
    </Group>
  );
}

function Swatch({ part }: { part: HerderContextPart }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
      style={{ background: PART_COLORS[part] }}
    />
  );
}

/** The last request as one bar against the window, with the forced-fold line. */
function CurrentCard({ snapshot }: { snapshot: HerderContextSnapshot }) {
  const { tokens, window, foldAt, parts } = snapshot;
  return (
    <Card title="当前上下文" right={`上次请求 ${timeOf(snapshot.at)}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="font-semibold text-2xl text-ink tabular-nums">
            {formatTokens(tokens)}
          </span>
          <span className="ml-1.5 text-ink-muted text-sm">/ {formatTokens(window)} tokens</span>
        </div>
        <div>
          <span className="font-semibold text-ink text-xl tabular-nums">
            {percent(tokens, window)}
          </span>
          <span className="ml-1.5 text-ink-muted text-sm">的工作窗口</span>
        </div>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-control-hover">
        <div className="flex h-full">
          {CONTEXT_PARTS.map((p) =>
            parts[p] > 0 ? (
              <div
                key={p}
                title={`${PART_LABELS[p]} ≈${formatTokens(parts[p])}`}
                style={{ width: `${(parts[p] / window) * 100}%`, background: PART_COLORS[p] }}
              />
            ) : null,
          )}
        </div>
        <div
          className="absolute top-0 bottom-0 w-px bg-danger"
          style={{ left: `${(foldAt / window) * 100}%` }}
          title="到这里 AgentHerd 会自动折叠最早的对话"
        />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {partsBySize(parts).map((p) => (
          <div key={p} className="flex items-center gap-2 text-sm" title={PART_HINTS[p]}>
            <Swatch part={p} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{PART_LABELS[p]}</span>
            <span className="text-ink-muted tabular-nums">≈{formatTokens(parts[p])}</span>
            <span className="w-11 text-right text-ink-dim tabular-nums">
              {percent(parts[p], tokens)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-ink-dim text-xs">
        工作窗口是主管模型的上下文长度，最多 128K。红线在 90%：到那里 AgentHerd
        会替主管把最早的对话折叠起来。数字是估算。
      </p>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-control px-3 py-2">
      <span className="font-semibold text-ink text-lg tabular-nums">{value}</span>
      <span className="truncate text-ink-muted text-xs">{label}</span>
      {sub !== undefined && <span className="truncate text-ink-dim text-xs">{sub}</span>}
    </div>
  );
}

function UsageCard({ view }: { view: HerderContextView }) {
  const [span, setSpan] = useState<"today" | "week">("today");
  const u: HerderUsage = span === "today" ? view.today : view.week;
  const peak = Math.max(1, ...view.days.map((d) => d.input + d.cacheRead + d.output));
  return (
    <Card
      title="用量和缓存"
      right={
        <span className="flex gap-1">
          {(["today", "week"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(s)}
              className={`rounded-md px-2 py-0.5 ${span === s ? "bg-control-active text-ink" : "hover:bg-control-hover"}`}
            >
              {s === "today" ? "今天" : "7 天"}
            </button>
          ))}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="模型请求" value={String(u.requests)} />
        <Stat label="输入（没命中缓存）" value={formatTokens(u.input)} />
        <Stat
          label="缓存命中"
          value={formatTokens(u.cacheRead)}
          sub={`命中率 ${percent(u.hitRate, 1)}`}
        />
        <Stat label="输出" value={formatTokens(u.output)} />
      </div>
      <div className="flex h-24 items-end gap-2">
        {view.days.map((d) => {
          const total = d.input + d.cacheRead + d.output;
          return (
            <div
              key={d.day}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <div
                className="flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-t"
                style={{ height: `${(total / peak) * 100}%` }}
                title={`${d.day}：${d.requests} 次请求，输入 ${formatTokens(d.input)}，缓存命中 ${formatTokens(d.cacheRead)}，输出 ${formatTokens(d.output)}`}
              >
                <div style={{ flex: d.cacheRead, background: "#14b8a6" }} />
                <div style={{ flex: d.input, background: "#3b82f6" }} />
                <div style={{ flex: d.output, background: "#f59e0b" }} />
              </div>
              <span className="text-ink-dim text-xs tabular-nums">{d.day.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 text-ink-muted text-xs">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: "#14b8a6" }} />
          缓存命中
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: "#3b82f6" }} />
          输入
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: "#f59e0b" }} />
          输出
        </span>
        <span className="ml-auto">数字是模型服务返回的；从 ADR 0093 这一版开始记</span>
      </div>
    </Card>
  );
}

/** One stacked bar per request; a drop marks a fold. */
function TrendCard({ trend }: { trend: HerderTrendPoint[] }) {
  const [hover, setHover] = useState<number | undefined>();
  if (trend.length === 0) {
    return (
      <Card title="趋势">
        <p className="text-ink-muted text-sm">
          还没有记录。主管下次回复后，这里会出现每次请求的大小。
        </p>
      </Card>
    );
  }
  const peak = Math.max(...trend.map((t) => t.tokens));
  const shown = hover === undefined ? trend.at(-1) : trend[hover];
  return (
    <Card title="趋势" right={`最近 ${trend.length} 次请求`}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: leaving the chart only clears the hover */}
      <div className="flex h-36 items-end gap-px" onMouseLeave={() => setHover(undefined)}>
        {trend.map((t, i) => {
          const dropped = i > 0 && t.tokens < (trend[i - 1]?.tokens ?? 0) * 0.8;
          return (
            <button
              type="button"
              key={t.at}
              aria-label={`${timeOf(t.at)} ≈${formatTokens(t.tokens)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              className={`relative flex h-full min-w-0 flex-1 cursor-default flex-col-reverse p-0 ${hover === i ? "opacity-100" : "opacity-85"}`}
            >
              <div
                className="flex flex-col-reverse"
                style={{ height: `${(t.tokens / peak) * 100}%` }}
              >
                {t.parts === undefined ? (
                  <div style={{ flex: 1, background: PART_COLORS.herder }} />
                ) : (
                  CONTEXT_PARTS.map((p) => {
                    const n = t.parts?.[p] ?? 0;
                    return n > 0 ? (
                      <div key={p} style={{ flex: n, background: PART_COLORS[p] }} />
                    ) : null;
                  })
                )}
              </div>
              {dropped && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[10px] text-ink-muted">
                  ✂
                </span>
              )}
            </button>
          );
        })}
      </div>
      {shown !== undefined && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-muted text-xs tabular-nums">
          <span className="text-ink-2">{timeOf(shown.at)}</span>
          <span>估算 ≈{formatTokens(shown.tokens)}</span>
          <span>
            模型算的输入 {formatTokens(shown.input + shown.cacheRead)}（命中{" "}
            {percent(shown.cacheRead, shown.input + shown.cacheRead)}）
          </span>
          <span>输出 {formatTokens(shown.output)}</span>
          <span className="text-ink-dim">{shown.model}</span>
        </div>
      )}
      <p className="text-ink-dim text-xs">
        每根柱子是一次请求，颜色同上面的分类；✂ 表示那次比上一次小了不少，通常是折叠了。
      </p>
    </Card>
  );
}

function BrowserCard({ snapshot }: { snapshot: HerderContextSnapshot }) {
  const [open, setOpen] = useState<HerderContextPart | undefined>();
  const [item, setItem] = useState<string | undefined>();
  return (
    <Card title="上下文里有什么" right={`共 ${snapshot.items.length} 项`}>
      <div className="flex flex-col">
        {CONTEXT_PARTS.filter((p) => snapshot.parts[p] > 0).map((p) => {
          const items = itemsOf(snapshot, p);
          const on = open === p;
          return (
            <div key={p} className="border-line border-t first:border-t-0">
              <button
                type="button"
                onClick={() => setOpen(on ? undefined : p)}
                className="flex w-full items-center gap-2 py-2 text-left text-sm hover:bg-hover"
              >
                {on ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Swatch part={p} />
                <span className="font-medium text-ink">{PART_LABELS[p]}</span>
                <span className="text-ink-dim">{items.length} 项</span>
                <span className="ml-auto text-ink-muted tabular-nums">
                  ≈{formatTokens(snapshot.parts[p])}
                </span>
                <span className="w-11 text-right text-ink-dim tabular-nums">
                  {percent(snapshot.parts[p], snapshot.tokens)}
                </span>
              </button>
              {on && (
                <div className="flex flex-col pb-2 pl-6">
                  {items.map((it, i) => {
                    const key = `${p}${i}`;
                    const shown = item === key;
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() => setItem(shown ? undefined : key)}
                          className="flex w-full items-center gap-2 py-1 text-left text-sm hover:bg-hover"
                        >
                          <span className="min-w-0 flex-1 truncate text-ink-2">{it.label}</span>
                          <span className="text-ink-muted tabular-nums">
                            ≈{formatTokens(it.tokens)}
                          </span>
                        </button>
                        {shown && (
                          <pre className="my-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-2 text-ink-2 text-xs">
                            {it.text}
                            {it.more > 0 ? `\n…（后面还有 ${it.more} 字）` : ""}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FoldRow({ fold }: { fold: HerderContextFold }) {
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const load = () => {
    setError(undefined);
    host()
      .herderContextFold(fold.blockId)
      .then(setOriginal)
      .catch((e: Error) => setError(e.message));
  };
  return (
    <div className="border-line border-t px-4 py-2.5 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="min-w-0 flex-1 truncate text-ink">
          {fold.forced ? "快满时自动折叠" : (fold.topic ?? "主管折叠的一段")}
        </span>
        {fold.forced ? <Badge tone="amber">自动</Badge> : <Badge tone="blue">主管</Badge>}
        <span className="text-ink-muted tabular-nums">
          {fold.messages} 条 · 省 ≈{formatTokens(fold.tokens)}
        </span>
        <span className="w-20 text-right text-ink-dim tabular-nums">{timeOf(fold.at)}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-6">
          <pre className="whitespace-pre-wrap rounded-md bg-inset p-2 text-ink-2 text-xs">
            {fold.summary}
          </pre>
          {original === undefined ? (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={load}>
                看原文
              </Button>
              {error !== undefined && <span className="text-danger-text text-xs">{error}</span>}
            </div>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-2 text-ink-2 text-xs">
              {original}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function FoldsCard({ folds }: { folds: HerderContextFold[] }) {
  const saved = folds.reduce((a, f) => a + f.tokens, 0);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium text-ink text-md">折叠记录</h3>
        <span className="text-ink-muted text-sm">
          {folds.length === 0
            ? "还没有折叠过"
            : `${folds.length} 段，一共省了 ≈${formatTokens(saved)}`}
        </span>
      </div>
      {folds.length > 0 && (
        <Group>
          {folds.map((f) => (
            <FoldRow key={f.blockId} fold={f} />
          ))}
        </Group>
      )}
    </section>
  );
}

export function HerderContextPanel() {
  const [view, setView] = useState<HerderContextView | undefined>();
  useEffect(() => {
    let alive = true;
    const load = () =>
      host()
        .herderContext()
        .then((v) => {
          if (alive) setView(v);
        })
        .catch(() => {
          // The connection banner explains a host that is not there.
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (view === undefined) return null;
  return (
    <div className="flex flex-col gap-4">
      {view.snapshot === undefined ? (
        <Group>
          <EmptyState
            icon={<Layers size={18} />}
            title="还没有这次启动后的请求"
            text={
              view.on
                ? "跟主管说句话，这里会显示它这次带了哪些内容。"
                : "主管没在工作，先在模型页给它选个模型。"
            }
          />
        </Group>
      ) : (
        <CurrentCard snapshot={view.snapshot} />
      )}
      <UsageCard view={view} />
      <TrendCard trend={view.trend} />
      {view.snapshot !== undefined && <BrowserCard snapshot={view.snapshot} />}
      <FoldsCard folds={view.folds} />
    </div>
  );
}
