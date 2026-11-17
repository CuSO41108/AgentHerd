// Agent: the coding agents AgentHerd picks from (Codex for GPT models, Pi for the rest). They ship
// inside the app at the version AgentHerd is adapted to (ADR 0067); nothing is downloaded or
// updated here. 验证 starts one once to prove it works.

import type { AgentCheck, AgentView } from "@agentherd/host/api";
import {
  CircleAlert,
  CircleCheck,
  Loader2,
  ShieldCheck,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Badge, Button, Group, IconTile, Section } from "../components/ui";
import { isAgentSecurityBlock } from "../platform";
import { call, useApp } from "../store";

const DESCRIPTIONS: Record<string, string> = {
  pi: "轻量的开源编程 Agent。简单的任务用它跑。",
  codex: "OpenAI 的 Codex。GPT 模型用它跑；跑不起来就换 Pi。",
};

/** How to sign in, for agents that use their own account. */
const LOGIN: Record<string, string> = {};

const SOURCES: Record<NonNullable<AgentView["source"]>, string> = {
  bundled: "App 自带",
  managed: "旧版 App 下载的",
  system: "你电脑上装的",
  config: "config.json 里配置的",
};

function StateBadge({ agent }: { agent: AgentView }) {
  switch (agent.state) {
    case "ready":
      return <Badge tone="green">可以用</Badge>;
    case "missing":
      return <Badge tone="amber">没有</Badge>;
  }
}

function Actions({ agent }: { agent: AgentView }) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<AgentView[] | undefined>) => {
    setBusy(true);
    const agents = await fn();
    if (agents !== undefined) useApp.setState({ agents });
    setBusy(false);
  };
  if (!agent.canRemove) return null;
  return (
    <Button
      disabled={busy}
      title="旧版 App 下载的一份；移除后改用 App 自带的"
      onClick={() => {
        if (window.confirm(`移除旧版 App 下载的 ${agent.name}？之后用 App 自带的那份。`))
          void act(() => call((h) => h.removeAgent(agent.id)));
      }}
    >
      <Trash2 size={13} />
      移除
    </Button>
  );
}

function detail(agent: AgentView): string {
  if (agent.state === "missing") {
    return "这个 App 里没带，你电脑上也没装。用安装包装的 App 自带它。";
  }
  if (agent.source === undefined) return "";
  const from = SOURCES[agent.source];
  if (agent.version === undefined) return from;
  const version = `${from}，版本 ${agent.version}`;
  return agent.adapted !== undefined && agent.adapted !== agent.version
    ? `${version}（AgentHerd 适配的是 ${agent.adapted}）`
    : version;
}

function CheckButton({ agent, onResult }: { agent: AgentView; onResult: (c: AgentCheck) => void }) {
  const [busy, setBusy] = useState(false);
  if (agent.state !== "ready") return null;
  return (
    <Button
      disabled={busy}
      title="在空目录里启动一次，看它能不能正常工作"
      onClick={async () => {
        setBusy(true);
        const check = await call((h) => h.verifyAgent(agent.id));
        setBusy(false);
        if (check !== undefined) onResult(check);
      }}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
      {busy ? "验证中" : "验证"}
    </Button>
  );
}

function CheckResult({ check, agent }: { check: AgentCheck; agent: AgentView }) {
  const seconds = (check.ms / 1000).toFixed(1);
  if (check.ok) {
    const version = check.agentVersion === undefined ? "" : ` ${check.agentVersion}`;
    return (
      <div className="mt-1 flex items-center gap-1.5 text-sm text-success-text">
        <CircleCheck size={13} />
        能用：{check.agentName ?? agent.name}
        {version} 已启动并建好会话（{seconds} 秒）
      </div>
    );
  }
  const killed = check.error?.includes("SIGKILL") ?? false;
  const blocked = !killed && isAgentSecurityBlock(check.error);
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-danger-text text-sm">
      <div className="flex items-center gap-1.5">
        <CircleAlert size={13} />
        {check.needsLogin
          ? `需要先登录。${LOGIN[agent.id] ?? ""}`
          : killed
            ? "进程被系统杀掉了（SIGKILL），可能是安全软件拦截了这个程序"
            : blocked
              ? "系统拒绝运行这个程序，可能是权限不足或被安全软件拦截"
              : "没能启动"}
      </div>
      {check.error !== undefined && check.error !== "" && (
        <div className="selectable ml-5 line-clamp-3 whitespace-pre-wrap font-mono text-ink-muted text-xs">
          {check.error}
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentView }) {
  const description = DESCRIPTIONS[agent.id];
  const [check, setCheck] = useState<AgentCheck | undefined>();
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <IconTile tone={agent.state === "ready" ? "green" : "gray"}>
          <SquareTerminal size={15} strokeWidth={1.75} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium text-ink text-md">
            {agent.name}
            <span className="font-mono font-normal text-ink-muted text-sm">/run {agent.id}</span>
            <StateBadge agent={agent} />
          </div>
          {description !== undefined && (
            <div className="mt-0.5 text-ink-2 text-sm">{description}</div>
          )}
          <div className="mt-0.5 text-ink-muted text-sm">{detail(agent)}</div>
          {agent.state === "ready" &&
            agent.path !== undefined &&
            agent.source !== "managed" &&
            agent.source !== "bundled" && (
              <div className="selectable mt-0.5 truncate font-mono text-ink-muted text-xs">
                {agent.path}
              </div>
            )}
          {LOGIN[agent.id] !== undefined && agent.state === "ready" && check === undefined && (
            <div className="mt-0.5 text-ink-muted text-sm">{LOGIN[agent.id]}</div>
          )}
          {check !== undefined && agent.state === "ready" && (
            <CheckResult check={check} agent={agent} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CheckButton agent={agent} onResult={setCheck} />
          <Actions agent={agent} />
        </div>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const agents = useApp((s) => s.agents);
  const ready = agents.filter((a) => a.state === "ready").length;
  return (
    <div className="flex flex-col gap-7">
      <Section
        title="编程 Agent"
        hint={
          ready === 0
            ? "不用选 Agent：GPT 模型用 Codex，其余用 Pi。它们跟着 App 一起装好，版本随 App 更新。"
            : `${ready} 个可以用。不用选：GPT 模型用 Codex，其余用 Pi。它们跟着 App 一起装好，版本随 App 更新。`
        }
      >
        <Group>
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} />
          ))}
        </Group>
      </Section>
    </div>
  );
}
