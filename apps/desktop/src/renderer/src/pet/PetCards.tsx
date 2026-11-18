// The cards of the pet's conversation (ADR 0072): what Feishu shows as cards, drawn the same way
// in the pet — a task's report, an approval, the Herder's question, an offer — and a card for each
// task, which follows the task as it runs. Buttons answer for the owner, as a tap in Feishu does.

import type { PetCard, PetCardView, TasksView } from "@agentherd/host/api";
import { type ReactNode, useState } from "react";
import { PetMarkdown } from "./PetMarkdown";
import {
  canStop,
  clockOf,
  cut,
  elapsedOf,
  foldBody,
  modelName,
  reportHead,
  TASK_STAGE,
} from "./pet-state";

type Task = TasksView["tasks"][number];
type Item = Extract<PetCardView, { kind: "item" }>;
type Tone = "green" | "red" | "amber" | "gray" | "purple" | "blue";

const RISK: Record<Item["risk"], { text: string; tone: Tone }> = {
  low: { text: "低风险", tone: "green" },
  medium: { text: "中风险", tone: "amber" },
  high: { text: "高风险", tone: "red" },
};

interface Actions {
  busy: boolean;
  offline: boolean;
  press(target: string, action: string): void;
  openTask(taskId: string): void;
}

function Shell(props: {
  tone: Tone;
  head: ReactNode;
  tag?: ReactNode;
  sub?: string | undefined;
  at?: string;
  children: ReactNode;
}) {
  return (
    <div className={`pet-cardx ${props.tone}`}>
      <div className="pet-cardx-h">
        <span className="pet-cardx-title">{props.head}</span>
        {props.tag}
      </div>
      {props.sub !== undefined && props.sub !== "" && (
        <div className="pet-cardx-sub">{props.sub}</div>
      )}
      <div className="pet-cardx-b">{props.children}</div>
      {props.at !== undefined && <div className="pet-cardx-time">{clockOf(props.at)}</div>}
    </div>
  );
}

function Fold(props: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pet-fold-part">
      <button type="button" className="pet-fold-btn" onClick={() => setOpen((x) => !x)}>
        {open ? "▾" : "▸"} {props.label}
      </button>
      {open && props.children}
    </div>
  );
}

function Buttons(props: {
  target: string;
  options: readonly { action: string; label: string }[];
  actions: Actions;
  wide?: boolean;
}) {
  const { busy, offline, press } = props.actions;
  if (props.options.length === 0) return null;
  return (
    <div className={props.wide === true ? "pet-answers" : "pet-actions"}>
      {props.options.map((o) => (
        <button
          key={o.action}
          type="button"
          disabled={busy || offline}
          className={o.action === "allow" || o.action === "allow-all" ? "primary" : ""}
          onClick={() => press(props.target, o.action)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Body(props: { text: string }) {
  const [all, setAll] = useState(false);
  const { head, folded } = foldBody(props.text);
  return (
    <>
      <PetMarkdown text={all || !folded ? props.text : `${head}…`} />
      {folded && (
        <button type="button" className="pet-fold-btn" onClick={() => setAll((x) => !x)}>
          {all ? "收起" : "展开全部"}
        </button>
      )}
    </>
  );
}

function Code(props: { text: string }) {
  return props.text === "" ? null : <pre className="pet-code">{props.text}</pre>;
}

function ItemCard(props: { view: Item; open: boolean; at: string; actions: Actions }) {
  const { view, actions } = props;
  const risk = RISK[view.risk];
  const closed = view.final !== undefined || !props.open;
  const tag = <span className={`pet-tag ${closed ? "gray" : risk.tone}`}>{risk.text}</span>;
  const head = view.taskLabel === undefined ? "⚠️ 等你确认" : `⚠️ 等你确认 · ${view.taskLabel}`;
  if (view.lines !== undefined) {
    return (
      <Shell tone={closed ? "gray" : "amber"} head={view.title} tag={tag} at={props.at}>
        {view.lines.map((line) => (
          <div key={line.itemId} className="pet-line">
            <div className="pet-cardx-strong">
              {line.n}. {line.title}
              {line.taskLabel !== undefined && (
                <span className="pet-muted"> · {line.taskLabel}</span>
              )}
            </div>
            <Code text={line.body} />
            {line.reason !== undefined && <div className="pet-muted">理由：{line.reason}</div>}
            {line.final !== undefined ? (
              <div className="pet-final">{line.final}</div>
            ) : (
              closed || <Buttons target={line.itemId} options={line.options} actions={actions} />
            )}
          </div>
        ))}
        {view.final !== undefined ? (
          <div className="pet-final">{view.final}</div>
        ) : (
          <>
            {view.body !== "" && <div className="pet-muted">{view.body}</div>}
            {closed || <Buttons target={view.itemId} options={view.options} actions={actions} />}
          </>
        )}
      </Shell>
    );
  }
  return (
    <Shell tone={closed ? "gray" : "amber"} head={head} tag={tag} at={props.at}>
      <div className="pet-cardx-strong">{view.title}</div>
      <Code text={view.body} />
      {view.reason !== undefined && <div className="pet-muted">理由：{view.reason}</div>}
      {view.final !== undefined ? (
        <div className="pet-final">{view.final}</div>
      ) : (
        closed || <Buttons target={view.itemId} options={view.options} actions={actions} />
      )}
    </Shell>
  );
}

/** One card sent to the owner, drawn as Feishu draws it. */
export function CardView(props: { card: PetCard; actions: Actions }) {
  const { card, actions } = props;
  const view = card.view;
  switch (view.kind) {
    case "report": {
      const { icon, tone } = reportHead(view);
      return (
        <Shell tone={tone} head={`${icon} ${view.title}`} sub={view.subtitle} at={card.at}>
          <Body text={view.body} />
          {view.fullReply !== undefined && (
            <Fold
              label={view.fullReplyBy === undefined ? "完整回复" : `${view.fullReplyBy} 的原话`}
            >
              <div className="pet-quote">{view.fullReply}</div>
            </Fold>
          )}
          {view.automaticDecisions.length > 0 && (
            <Fold label={`自动处理的审批 · ${view.automaticDecisions.length}`}>
              <ul className="pet-list">
                {view.automaticDecisions.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </Fold>
          )}
          <div className="pet-actions">
            <button type="button" onClick={() => actions.openTask(view.taskId)}>
              打开任务
            </button>
          </div>
        </Shell>
      );
    }
    case "item":
      return <ItemCard view={view} open={card.open} at={card.at} actions={actions} />;
    case "ask": {
      const closed = view.final !== undefined || !card.open;
      return (
        <Shell tone={closed ? "gray" : "purple"} head="主管问你" at={card.at}>
          <PetMarkdown text={view.text} />
          {view.final !== undefined ? (
            <div className="pet-final">你选了：{view.final}</div>
          ) : closed ? (
            <div className="pet-muted">已经不用回答了</div>
          ) : (
            <Buttons target={view.askId} options={view.options} actions={actions} wide />
          )}
        </Shell>
      );
    }
    case "text": {
      const tone: Tone = view.tone === "error" ? "red" : view.tone === "alarm" ? "amber" : "blue";
      const head = view.title ?? (view.taskLabel === undefined ? "AgentHerd" : view.taskLabel);
      return (
        <Shell tone={card.open ? tone : "gray"} head={head} at={card.at}>
          <PetMarkdown text={view.text} />
          {card.open && view.target !== undefined && view.options !== undefined && (
            <Buttons target={view.target} options={view.options} actions={actions} />
          )}
        </Shell>
      );
    }
  }
}

/** A task as it is now: where it stands, for how long, its latest step; stop or open it. */
export function TaskCard(props: {
  task: Task;
  now: number;
  busy: boolean;
  stop(taskId: string): void;
  open(taskId: string): void;
}) {
  const { task } = props;
  const stage = TASK_STAGE[task.stage];
  const running = canStop(task);
  const [asking, setAsking] = useState(false);
  const meta = [task.agent, modelName(task.model), elapsedOf(task, props.now)].filter(
    (x) => x !== undefined && x !== "",
  );
  return (
    <div className={`pet-task${running ? " running" : ""}`}>
      <div className="pet-task-row">
        <span className="pet-task-title" title={task.title}>
          {task.title}
        </span>
        <span className={`pet-pill ${stage.tone}`}>{stage.text}</span>
      </div>
      <div className="pet-task-meta">{meta.join(" · ")}</div>
      {task.lastReport !== "" && (
        <div className="pet-task-step" title={task.lastReport}>
          {cut(task.lastReport, 160)}
        </div>
      )}
      {running && <div className="pet-task-bar" aria-hidden="true" />}
      <div className="pet-task-btns">
        <button type="button" onClick={() => props.open(task.id)}>
          打开
        </button>
        {running &&
          (asking ? (
            <>
              <button
                type="button"
                className="danger"
                disabled={props.busy}
                onClick={() => {
                  setAsking(false);
                  props.stop(task.id);
                }}
              >
                确定停止
              </button>
              <button type="button" className="ghost" onClick={() => setAsking(false)}>
                不停
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost"
              disabled={props.busy}
              onClick={() => setAsking(true)}
            >
              停止
            </button>
          ))}
      </div>
    </div>
  );
}
