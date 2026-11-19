// 设置: the Feishu channel, how approvals work, font size, the desktop pet, keep awake, the first run, and where
// AgentHerd keeps its files. How the Herder talks is on the 主管 page; the owner's apps and
// platforms are on the 应用连接 page.

import type { PetFigure, PetSettings, SettingsPatch } from "@agentherd/host/api";
import {
  Bell,
  BellOff,
  Check,
  Eye,
  FolderOpen,
  Hand,
  Info,
  Moon,
  MoonStar,
  Palette,
  PawPrint,
  Rocket,
  Type,
  Volume2,
} from "lucide-react";
import { useState } from "react";
import { isQuiet, quietLine, snoozeUntil } from "../../../shared/pet-notify";
import { FeishuSection } from "../components/FeishuSection";
import {
  Button,
  Group,
  IconTile,
  inputClass,
  Row,
  Section,
  Segmented,
  Switch,
} from "../components/ui";
import { FONT_SCALES, setFontScale, useFontScale } from "../font-scale";
import { FIGURE_CREDIT, FIGURES } from "../pet/figures";
import { isMac } from "../platform";
import { call, type Mode, useApp } from "../store";

const PET_FIGURE_OPTIONS = (Object.keys(FIGURES) as PetFigure[]).map((value) => ({
  value,
  label: FIGURES[value].name,
}));

const MODES: { mode: Mode; title: string; hint: string; icon: typeof Eye }[] = [
  {
    mode: "observe",
    title: "只观察",
    hint: "什么都不自动放行，每个请求都发到飞书等你批准",
    icon: Eye,
  },
  {
    mode: "assist",
    title: "协助",
    hint: "本机上的操作自动放行；推送、开 PR、发消息、大量删除等你批准",
    icon: Hand,
  },
];

export function SettingsPage() {
  const status = useApp((s) => s.status);
  const openFirstRun = useApp((s) => s.openFirstRun);
  const [busy, setBusy] = useState(false);
  const fontScale = useFontScale();

  const update = async (patch: SettingsPatch) => {
    setBusy(true);
    const next = await call((h) => h.updateSettings(patch));
    if (next !== undefined) useApp.setState({ status: next });
    setBusy(false);
  };

  if (status === undefined) return null;

  return (
    <div className="flex flex-col gap-7">
      <FeishuSection />

      <Section title="审批方式">
        <Group>
          {MODES.map(({ mode, title, hint, icon: Icon }) => {
            const active = status.mode === mode;
            return (
              <label key={mode} className="block cursor-pointer hover:bg-hover">
                <input
                  type="radio"
                  name="mode"
                  className="peer sr-only"
                  checked={active}
                  disabled={busy}
                  onChange={() => void update({ mode })}
                />
                <Row
                  className="peer-focus-visible:bg-hover"
                  icon={
                    <IconTile tone={active ? "blue" : "gray"}>
                      <Icon size={15} strokeWidth={1.75} />
                    </IconTile>
                  }
                  title={title}
                  description={hint}
                  trailing={active ? <Check size={16} className="text-accent-text" /> : undefined}
                />
              </label>
            );
          })}
          {!MODES.some((m) => m.mode === status.mode) && (
            <div className="px-4 py-2.5 text-ink-muted text-sm">当前模式：{status.mode}</div>
          )}
        </Group>
      </Section>

      <Section title="外观">
        <Group>
          <Row
            icon={
              <IconTile>
                <Type size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="字体大小"
            description="整个界面的文字大小，只对这台电脑生效"
            trailing={
              <Segmented
                label="字体大小"
                options={FONT_SCALES}
                value={fontScale}
                onChange={setFontScale}
              />
            }
          />
        </Group>
      </Section>

      <Section title="桌宠">
        <Group>
          <Row
            icon={
              <IconTile tone="blue">
                <PawPrint size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="显示桌宠"
            description="浮在桌面上，飞书收到的消息她也会说；点她就能跟主管说话、直接批准"
            trailing={
              <Switch
                label="显示桌宠"
                checked={status.pet?.on ?? false}
                disabled={busy || status.pet === undefined}
                onChange={(on) => void update({ pet: { on } })}
              />
            }
          />
          <Row
            icon={
              <IconTile>
                <Palette size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="形象"
            description={FIGURE_CREDIT}
            trailing={
              <Segmented
                label="形象"
                options={PET_FIGURE_OPTIONS}
                value={status.pet?.figure ?? "deepseek"}
                onChange={(figure) => void update({ pet: { figure } })}
              />
            }
          />
        </Group>
        <PetQuiet pet={status.pet} busy={busy} update={update} />
      </Section>

      <Section title="电源">
        <Group>
          <Row
            icon={
              <IconTile>
                <MoonStar size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="防止休眠"
            description={
              isMac()
                ? "有任务在跑时让电脑保持唤醒，合上盖子也能继续"
                : "有任务在跑时阻止电脑空闲自动休眠，关闭窗口后在托盘保持连接"
            }
            trailing={
              <Switch
                label="防止休眠"
                checked={status.keepAwake}
                disabled={busy}
                onChange={(keepAwake) => void update({ keepAwake })}
              />
            }
          />
        </Group>
      </Section>

      <Section title="关于">
        <Group>
          <Row
            icon={
              <IconTile>
                <Rocket size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="重新运行引导"
            description="一步步绑定飞书、添加模型服务、给主管选模型"
            trailing={<Button onClick={openFirstRun}>打开引导</Button>}
          />
          <Row
            icon={
              <IconTile>
                <FolderOpen size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="数据目录"
            trailing={
              <span
                className="selectable block max-w-[420px] truncate font-mono text-ink-muted text-sm"
                title={status.home}
              >
                {status.home}
              </span>
            }
          />
          <Row
            icon={
              <IconTile>
                <Info size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="版本"
            trailing={
              <span className="selectable font-mono text-ink-muted text-sm">{status.version}</span>
            }
          />
        </Group>
      </Section>
    </div>
  );
}

/** Default quiet hours when the owner turns them on (ADR 0079). */
const QUIET_DEFAULT = "22:00-08:00";

/** Notifications, sound, quiet hours and a snooze for the pet (ADR 0079). */
function PetQuiet({
  pet,
  busy,
  update,
}: {
  pet: PetSettings | undefined;
  busy: boolean;
  update: (patch: SettingsPatch) => Promise<void>;
}) {
  // An older host has no notification settings.
  if (pet?.notify === undefined) return null;
  const now = new Date();
  const [from = "22:00", to = "08:00"] = (pet.quietHours || QUIET_DEFAULT).split("-");
  const snoozed = pet.quietUntil !== "" && Date.parse(pet.quietUntil) > now.getTime();
  const setHours = (a: string, b: string) => {
    if (/^\d\d:\d\d$/.test(a) && /^\d\d:\d\d$/.test(b))
      void update({ pet: { quietHours: `${a}-${b}` } });
  };
  return (
    <Group className="mt-3">
      <Row
        icon={
          <IconTile tone="blue">
            <Bell size={15} strokeWidth={1.75} />
          </IconTile>
        }
        title="系统通知"
        description="要你确认的事、主管问你的话和任务结果，桌宠和 App 不在眼前时也弹通知；点通知就打开桌宠"
        trailing={
          <Switch
            label="系统通知"
            checked={pet.notify}
            disabled={busy}
            onChange={(notify) => void update({ pet: { notify } })}
          />
        }
      />
      <Row
        icon={
          <IconTile>
            <Volume2 size={15} strokeWidth={1.75} />
          </IconTile>
        }
        title="提示音"
        description="要你确认、主管提问和没做成的任务会响；做完的任务只弹不响"
        trailing={
          <Switch
            label="提示音"
            checked={pet.sound}
            disabled={busy || !pet.notify}
            onChange={(sound) => void update({ pet: { sound } })}
          />
        }
      />
      <Row
        icon={
          <IconTile>
            <Moon size={15} strokeWidth={1.75} />
          </IconTile>
        }
        title="免打扰时段"
        description="这段时间不弹通知、不响，桌宠也不自己打开对话；事情照样记着，点开就能看"
        trailing={
          <>
            {pet.quietHours !== "" && (
              <span className="flex items-center gap-1 text-sm text-ink-muted">
                <input
                  type="time"
                  aria-label="免打扰开始"
                  className={`${inputClass} w-[92px]`}
                  value={from}
                  disabled={busy}
                  onChange={(e) => setHours(e.target.value, to)}
                />
                到
                <input
                  type="time"
                  aria-label="免打扰结束"
                  className={`${inputClass} w-[92px]`}
                  value={to}
                  disabled={busy}
                  onChange={(e) => setHours(from, e.target.value)}
                />
              </span>
            )}
            <Switch
              label="免打扰时段"
              checked={pet.quietHours !== ""}
              disabled={busy}
              onChange={(on) => void update({ pet: { quietHours: on ? QUIET_DEFAULT : "" } })}
            />
          </>
        }
      />
      <Row
        icon={
          <IconTile>
            <BellOff size={15} strokeWidth={1.75} />
          </IconTile>
        }
        title="暂停提醒"
        description={
          snoozed
            ? `${quietLine(pet, now) ?? ""}，到点自动恢复`
            : isQuiet(pet, now)
              ? "现在在免打扰时段里"
              : "临时安静一会儿；菜单栏的小羊图标里也能点"
        }
        trailing={
          snoozed ? (
            <Button disabled={busy} onClick={() => void update({ pet: { quietUntil: "" } })}>
              恢复提醒
            </Button>
          ) : (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  void update({ pet: { quietUntil: snoozeUntil("hour", new Date()) } })
                }
              >
                1 小时
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void update({ pet: { quietUntil: snoozeUntil("morning", new Date()) } })
                }
              >
                到明早 8 点
              </Button>
            </>
          )
        }
      />
    </Group>
  );
}
