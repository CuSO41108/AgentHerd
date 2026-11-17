// "用订阅登录" (ADR 0068): sign in to a model account (ChatGPT, Claude, Copilot…) instead of
// giving a key. The list comes from pi-ai through the host; the host runs the vendor's flow and
// reports it as "login" events: a page to open, a device code, or a question to answer.

import type { LoginView, SubscriptionView } from "@agentherd/host/api";
import { CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { call, host, useApp } from "../store";
import { Modal } from "./Modal";
import { Badge, Button, Group, IconTile, inputClass, Row } from "./ui";

/** Vendors whose terms have limited third-party tools using a personal plan. */
const TERMS_RISK = new Set(["anthropic"]);

/** A service id not used yet: the vendor id, then vendor-2, vendor-3… */
function freeId(provider: string, taken: readonly string[]): string {
  if (!taken.includes(provider)) return provider;
  for (let n = 2; ; n++) if (!taken.includes(`${provider}-${n}`)) return `${provider}-${n}`;
}

function Vendors({ onPick }: { onPick: (v: SubscriptionView) => void }) {
  const [list, setList] = useState<SubscriptionView[] | undefined>();
  useEffect(() => {
    void call((h) => Promise.resolve(h.subscriptions())).then((v) => setList(v ?? []));
  }, []);
  if (list === undefined)
    return (
      <div className="flex items-center gap-2 py-6 text-ink-muted">
        <Loader2 size={14} className="animate-spin" /> 读取中…
      </div>
    );
  return (
    <Group>
      {list.map((v) => (
        <Row
          key={v.provider}
          icon={
            <IconTile tone="blue">
              <KeyRound size={15} />
            </IconTile>
          }
          title={
            <span className="flex items-center gap-2">
              {v.name}
              {v.subscription && <Badge tone="blue">订阅</Badge>}
              {TERMS_RISK.has(v.provider) && <Badge tone="amber">注意条款</Badge>}
            </span>
          }
          description={`${v.models.length} 个模型`}
          trailing={
            <Button size="sm" onClick={() => onPick(v)}>
              登录
            </Button>
          }
        />
      ))}
    </Group>
  );
}

function Question({ login }: { login: LoginView }) {
  const prompt = login.prompt;
  const [value, setValue] = useState("");
  if (prompt === undefined) return null;
  const send = (v: string) => void call((h) => Promise.resolve(h.answerLogin(login.id, v)));
  if (prompt.type === "select")
    return (
      <div className="flex flex-col gap-2">
        <div className="text-ink">{prompt.message}</div>
        <Group>
          {(prompt.options ?? []).map((o) => (
            <Row
              key={o.id}
              title={o.label}
              description={o.description}
              trailing={
                <Button size="sm" onClick={() => send(o.id)}>
                  选这个
                </Button>
              }
            />
          ))}
        </Group>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() !== "") send(value.trim());
      }}
    >
      <div className="text-ink">{prompt.message}</div>
      <div className="flex gap-2">
        <input
          className={`${inputClass} flex-1`}
          type={prompt.type === "secret" ? "password" : "text"}
          placeholder={prompt.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={value.trim() === ""}>
          确定
        </Button>
      </div>
    </form>
  );
}

function Progress({ login, vendor }: { login: LoginView; vendor: SubscriptionView }) {
  if (login.status === "done")
    return (
      <div className="flex items-start gap-2 text-ink">
        <CheckCircle2 size={16} className="mt-0.5 text-success-text" />
        <div>
          已登录 {vendor.name}，可以用 {login.models?.length ?? 0} 个模型。
          <div className="text-ink-muted text-sm">
            在「主管用的模型」或模型分档里选它们就行；任务里的订阅模型由 Pi 来跑。
          </div>
        </div>
      </div>
    );
  if (login.status === "failed")
    return (
      <div className="flex items-start gap-2 text-danger-text">
        <TriangleAlert size={16} className="mt-0.5" />
        <div>没登录上：{login.error}</div>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      {login.userCode !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="text-ink-muted text-sm">在登录页输入这个代码</div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-2xl text-ink tracking-wider">
              {login.userCode}
            </span>
            <Button
              size="sm"
              onClick={() => void navigator.clipboard.writeText(login.userCode ?? "")}
            >
              <Copy size={12} /> 复制
            </Button>
          </div>
        </div>
      )}
      {login.url !== undefined && (
        <div className="flex flex-col gap-1">
          {login.instructions !== undefined && (
            <div className="text-ink-muted text-sm">{login.instructions}</div>
          )}
          <div>
            <Button variant="primary" onClick={() => window.open(login.url, "_blank")}>
              <ExternalLink size={14} /> 打开登录页
            </Button>
          </div>
        </div>
      )}
      <Question key={login.prompt?.message ?? ""} login={login} />
      <div className="flex items-center gap-2 text-ink-muted text-sm">
        <Loader2 size={13} className="animate-spin" />
        {login.progress ?? "等你在浏览器里登录…"}
      </div>
    </div>
  );
}

export function SubscriptionDialog({
  onClose,
  again,
}: {
  onClose: () => void;
  /** Sign in again to a saved service (its token was refused, or another account). */
  again?: { provider: string; serviceId: string };
}) {
  const services = useApp((s) => s.models?.services ?? []);
  const login = useApp((s) => s.login);
  const [vendor, setVendor] = useState<SubscriptionView | undefined>();
  const [loginId, setLoginId] = useState<string | undefined>();
  const mine = login !== undefined && login.id === loginId ? login : undefined;

  const start = async (v: SubscriptionView) => {
    setVendor(v);
    const id =
      again?.serviceId ??
      freeId(
        v.provider,
        services.map((s) => s.id),
      );
    const view = await call((h) => Promise.resolve(h.startLogin(v.provider, id)));
    if (view === undefined) return;
    useApp.setState({ login: view });
    setLoginId(view.id);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, for `again` only
  useEffect(() => {
    if (again === undefined) return;
    void call((h) => Promise.resolve(h.subscriptions())).then((list) => {
      const v = list?.find((x) => x.provider === again.provider);
      if (v !== undefined) void start(v);
    });
  }, []);
  const close = () => {
    if (mine?.status === "running") void host().cancelLogin(mine.id);
    onClose();
  };

  if (vendor === undefined && again !== undefined)
    return (
      <Modal title="用订阅登录" onClose={close}>
        <div className="flex items-center gap-2 text-ink-muted">
          <Loader2 size={14} className="animate-spin" /> 正在打开登录…
        </div>
      </Modal>
    );
  if (vendor === undefined)
    return (
      <Modal
        title="用订阅登录"
        description="不用 Key，用你已有的账号（比如 ChatGPT Plus、GitHub Copilot）。登录凭据只保存在本机。"
        onClose={close}
      >
        <Vendors onPick={(v) => void start(v)} />
      </Modal>
    );
  return (
    <Modal
      title={`登录 ${vendor.name}`}
      description={
        TERMS_RISK.has(vendor.provider)
          ? "这家曾限制第三方工具使用个人订阅，可能有封号风险，请先看清它现在的条款。"
          : undefined
      }
      onClose={close}
      footer={
        mine?.status === "running" ? (
          <Button onClick={close}>取消登录</Button>
        ) : mine?.status === "failed" ? (
          <>
            <Button onClick={close}>关闭</Button>
            <Button variant="primary" onClick={() => void start(vendor)}>
              再试一次
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        )
      }
    >
      {mine === undefined ? (
        <div className="flex items-center gap-2 text-ink-muted">
          <Loader2 size={14} className="animate-spin" /> 正在打开登录…
        </div>
      ) : (
        <Progress login={mine} vendor={vendor} />
      )}
    </Modal>
  );
}
