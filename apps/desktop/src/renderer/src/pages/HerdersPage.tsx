// 主管: the Herder's action trail and nothing else. Its model is chosen on the 模型 page; when
// the Herder is not working, one line says why and links there.

import { CircleAlert } from "lucide-react";
import { herderReasonLabel } from "../components/labels";
import { Button } from "../components/ui";
import { useApp } from "../store";
import { HerderActivity } from "./HerderActivityPage";

export function HerdersPage() {
  const herder = useApp((s) => s.status?.herder);
  const setPage = useApp((s) => s.setPage);
  return (
    <div className="flex flex-col gap-4">
      {herder !== undefined && !herder.on && (
        <div className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-md text-warning-text">
          <CircleAlert size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">主管没在工作：{herderReasonLabel(herder.reason)}</span>
          <Button size="sm" onClick={() => setPage("models")}>
            去模型页
          </Button>
        </div>
      )}
      <HerderActivity />
    </div>
  );
}
