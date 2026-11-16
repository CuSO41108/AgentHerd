// 主管 › 说话风格: how the Herder talks to the owner (ADR 0053).

import type { SettingsPatch } from "@agentherd/host/api";
import { Check, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Group, IconTile, Row } from "../components/ui";
import { HERDER_STYLE_LABELS } from "../herder-styles";
import { call, useApp } from "../store";

export function HerderStylePage() {
  const status = useApp((s) => s.status);
  const [busy, setBusy] = useState(false);
  if (status === undefined) return null;

  const update = async (patch: SettingsPatch) => {
    setBusy(true);
    const next = await call((h) => h.updateSettings(patch));
    if (next !== undefined) useApp.setState({ status: next });
    setBusy(false);
  };

  return (
    <Group>
      {HERDER_STYLE_LABELS.map(({ style, title, hint, sample }) => {
        const active = status.herderStyle === style;
        return (
          <label key={style} className="block cursor-pointer hover:bg-hover">
            <input
              type="radio"
              name="herderStyle"
              className="peer sr-only"
              checked={active}
              disabled={busy}
              onChange={() => void update({ herderStyle: style })}
            />
            <Row
              className="peer-focus-visible:bg-hover"
              icon={
                <IconTile tone={active ? "blue" : "gray"}>
                  <MessageCircle size={15} strokeWidth={1.75} />
                </IconTile>
              }
              title={title}
              description={
                <>
                  {hint}
                  <span className="mt-1 block text-ink-dim">例：{sample}</span>
                </>
              }
              trailing={active ? <Check size={16} className="text-accent-text" /> : undefined}
            />
          </label>
        );
      })}
    </Group>
  );
}
