// The two figures that come with the app (ADR 0070). Each strip holds six 192×208 frames, in the
// order of MOODS, cut from the Q-version sprites of the llm-pet project (see figures/NOTICE.md).

import type { PetFigure } from "@agentherd/host/api";
import claudeStrip from "./figures/claude.webp";
import deepseekStrip from "./figures/deepseek.webp";

export const FRAME = { width: 192, height: 208 } as const;

export const FIGURES: Record<PetFigure, { name: string; strip: string }> = {
  deepseek: { name: "大肥鱼", strip: deepseekStrip },
  claude: { name: "Claude 娘", strip: claudeStrip },
};

export const FIGURE_CREDIT = "形象由画师 ZipZipPipe 绘制，来自 llm-pet 项目，仅限非商用";
