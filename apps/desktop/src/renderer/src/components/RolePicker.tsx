// Choosing a model from the list for a role (ADR 0021): a custom grouped selector and a 试一下
// row for the Herder's model on the 模型 page.

import type { ModelTest } from "@agentherd/host/api";
import { Bot, CircleAlert, CircleCheck, Loader2, Play } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { applyModels, call, type ModelRef, type ModelRole, useApp } from "../store";
import { Select, type SelectSection } from "./Select";
import { Button, Group, IconTile, Row } from "./ui";

const NONE = "";

function encode(ref: ModelRef): string {
  return JSON.stringify([ref.serviceId, ref.model]);
}

function decode(value: string): ModelRef | null {
  if (value === NONE) return null;
  const parsed: unknown = JSON.parse(value);
  if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
    return { serviceId: parsed[0], model: parsed[1] };
  }
  return null;
}

/** A grouped selector over every listed model; picking one saves it for the role right away. */
export function RoleSelect({
  modelRole,
  label,
  className = "w-72 max-w-[42vw]",
  onChosen,
}: {
  modelRole: ModelRole;
  label: string;
  className?: string;
  /** Called after a choice was saved, with the new model (null for 不选). */
  onChosen?: (ref: ModelRef | null) => void;
}) {
  const models = useApp((s) => s.models);
  const [busy, setBusy] = useState(false);
  const services = models?.services ?? [];
  const ref = models?.roles[modelRole];
  const current = ref === undefined ? NONE : encode(ref);
  const listed = services.some((s) => s.id === ref?.serviceId && s.models.includes(ref.model));

  const sections = useMemo<SelectSection[]>(() => {
    const topOptions: SelectSection["options"] = [
      { value: NONE, label: "不选", muted: true },
      ...(ref !== undefined && !listed
        ? [
            {
              value: current,
              label: ref.model,
              tag: ref.serviceId,
              mono: true,
              badge: "不在列表",
              badgeTone: "amber" as const,
            },
          ]
        : []),
    ];
    const groups: SelectSection[] = services
      .filter((s) => s.models.length > 0)
      .map((s) => ({
        id: s.id,
        label: s.name,
        ...(!s.hasKey && s.kind === "builtin"
          ? { badge: "没有 Key", badgeTone: "amber" as const }
          : {}),
        options: s.models.map((m) => ({
          value: encode({ serviceId: s.id, model: m }),
          label: m,
          tag: s.name,
          mono: true,
          keywords: `${s.name} ${s.id}`,
        })),
      }));
    return [{ id: "_none", options: topOptions }, ...groups];
  }, [services, ref, listed, current]);

  const choose = async (value: string) => {
    const next = decode(value);
    setBusy(true);
    const view = await call((h) => h.chooseModel(modelRole, next));
    setBusy(false);
    if (view === undefined) return;
    applyModels(view);
    onChosen?.(next);
  };

  return (
    <Select
      label={label}
      value={current}
      sections={sections}
      onChange={(nextValue) => void choose(nextValue)}
      placeholder="未选择模型"
      align="end"
      minMenuWidth={300}
      searchPlaceholder="搜索模型或服务…"
      busy={busy}
      disabled={busy || models === undefined}
      className={className}
    />
  );
}

/** What trying a model found: a short reply, or why it failed. */
function TestResult({ testing, result }: { testing: boolean; result: ModelTest | null }) {
  if (!testing && result === null) return null;
  const tone = testing
    ? "bg-control-hover text-ink-muted"
    : result?.ok === true
      ? "bg-success-soft text-success-text"
      : "bg-danger-soft text-danger-text";
  return (
    <div className={`mx-4 mb-3 ml-14 flex items-start gap-2 rounded-md px-3 py-2 text-sm ${tone}`}>
      {testing && (
        <>
          <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
          <span>正在试一下…</span>
        </>
      )}
      {result?.ok === true && (
        <>
          <CircleCheck size={14} className="mt-0.5 shrink-0" />
          <span className="selectable min-w-0 break-words">{result.reply}</span>
        </>
      )}
      {result?.ok === false && (
        <>
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <span className="selectable min-w-0 break-words">{result.message}</span>
        </>
      )}
    </div>
  );
}

/** One role: its select, a 试一下 button, and what the try found. */
export function RoleRow({
  modelRole,
  title,
  description,
  icon,
}: {
  modelRole: ModelRole;
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
}) {
  const ref = useApp((s) => s.models?.roles[modelRole]);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ModelTest | null>(null);
  const test = async (target: ModelRef) => {
    setTesting(true);
    setResult(null);
    const outcome = await call((h) => h.testModel(target));
    setTesting(false);
    if (outcome !== undefined) setResult(outcome);
  };
  return (
    <div>
      <Row
        className="min-h-14"
        icon={icon}
        title={title}
        description={description}
        trailing={
          <>
            <RoleSelect
              modelRole={modelRole}
              label={modelRole === "herder" ? "主管的模型" : "Pi 的模型"}
              className="w-72 max-w-[42vw]"
              onChosen={(next) => {
                setResult(null);
                if (next !== null) void test(next);
              }}
            />
            <Button
              className="h-8 px-3"
              disabled={ref === undefined || testing}
              onClick={() => {
                if (ref !== undefined) void test(ref);
              }}
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
              试一下
            </Button>
          </>
        }
      />
      <TestResult testing={testing} result={result} />
    </div>
  );
}

/** The 模型 page's group for the Herder's model. Pi's own model is not chosen here: tasks pick
 * from the tiers. */
export function RolePicker() {
  const count = useApp((s) => s.models?.services.length ?? 0);
  const on = useApp((s) => s.status?.herder.on === true);
  return (
    <Group>
      <RoleRow
        modelRole="herder"
        icon={
          <IconTile tone={on ? "green" : "gray"}>
            <Bot size={15} strokeWidth={1.75} />
          </IconTile>
        }
        title="主管用的模型"
        description="在飞书里跟你说话、开任务；用快一点、便宜一点的就够"
      />
      {count === 0 && (
        <div className="bg-warning-soft/40 px-4 py-2.5 text-sm text-warning-text">
          还没有模型服务。先在下面添加一个服务，再回来选模型。
        </div>
      )}
    </Group>
  );
}
