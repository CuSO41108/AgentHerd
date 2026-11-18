// The two figures that come with the app (ADR 0070). Each is an atlas of 192×208 cells laid out as
// in sprite.ts, cut from the Q-version sprites of the llm-pet project (see figures/NOTICE.md).

import type { PetFigure } from "@agentherd/host/api";
import claudeAtlas from "./figures/claude.webp";
import deepseekAtlas from "./figures/deepseek.webp";

export const FIGURES: Record<PetFigure, { name: string; atlas: string }> = {
  deepseek: { name: "大肥鱼", atlas: deepseekAtlas },
  claude: { name: "Claude 娘", atlas: claudeAtlas },
};

export const FIGURE_CREDIT = "形象由画师 ZipZipPipe 绘制，来自 llm-pet 项目，仅限非商用";
