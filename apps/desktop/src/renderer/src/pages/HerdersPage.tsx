// 主管: whether the Herder is working and its model (with 试一下); its speaking style and its
// action log open as their own pages.

import { Bot, ChevronRight, History, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { herderReasonLabel } from "../components/labels";
import { RoleRow } from "../components/RolePicker";
import { Button, Dot, Group, IconTile, Row } from "../components/ui";
import { HERDER_STYLE_LABELS } from "../herder-styles";
import { type Page, useApp } from "../store";

function OpenRow({
  page,
  icon,
  title,
  description,
}: {
  page: Page;
  icon: ReactNode;
  title: string;
  description: ReactNode;
}) {
  const setPage = useApp((s) => s.setPage);
  return (
    <button
      type="button"
      data-open={page}
      onClick={() => setPage(page)}
      className="block w-full text-left hover:bg-hover"
    >
      <Row
        icon={icon}
        title={title}
        description={description}
        trailing={<ChevronRight size={16} className="text-ink-muted" />}
      />
    </button>
  );
}

export function HerdersPage() {
  const status = useApp((s) => s.status);
  const setPage = useApp((s) => s.setPage);
  const serviceCount = useApp((s) => s.models?.services.length ?? 0);
  if (status === undefined) return null;
  const herder = status.herder;
  const style = HERDER_STYLE_LABELS.find((s) => s.style === status.herderStyle);

  return (
    <div className="flex flex-col gap-7">
      <Group>
        <RoleRow
          modelRole="herder"
          icon={
            <IconTile tone={herder.on ? "green" : "gray"}>
              <Bot size={15} strokeWidth={1.75} />
            </IconTile>
          }
          title={
            <span className="flex items-center gap-2">
              主管
              <Dot tone={herder.on ? "green" : "gray"} />
              <span className="font-normal text-ink-muted text-sm">
                {herder.on ? "工作中" : "已关闭"}
              </span>
            </span>
          }
          description={
            herder.on
              ? "在飞书里跟你说话、开任务；用快一点、便宜一点的模型就够"
              : herderReasonLabel(herder.reason)
          }
        />
        {serviceCount === 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-ink-muted text-sm">
            还没有模型服务，先添加一个才能选模型。
            <Button size="sm" onClick={() => setPage("models")}>
              去添加
            </Button>
          </div>
        )}
      </Group>

      <Group>
        <OpenRow
          page="herder-style"
          icon={
            <IconTile tone="blue">
              <MessageCircle size={15} strokeWidth={1.75} />
            </IconTile>
          }
          title="说话风格"
          description={style === undefined ? "选主管跟你说话的方式" : `现在：${style.title}`}
        />
        <OpenRow
          page="herder-activity"
          icon={
            <IconTile tone="gray">
              <History size={15} strokeWidth={1.75} />
            </IconTile>
          }
          title="行动记录"
          description="每一轮因为什么开始、做了哪些事、回了你什么"
        />
      </Group>
    </div>
  );
}
