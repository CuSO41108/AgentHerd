// Pure positioning, filtering and keyboard-stepping helpers for custom Select popovers.
// Kept DOM-free so unit tests can exercise layout math and search directly in Node.

export interface SelectOption {
  value: string;
  label: string;
  /** Quiet provider/source pill shown inside the closed trigger button. */
  tag?: string;
  badge?: string;
  badgeTone?: "gray" | "amber";
  mono?: boolean;
  muted?: boolean;
  keywords?: string;
}

export interface SelectSection {
  id: string;
  label?: string;
  badge?: string;
  badgeTone?: "gray" | "amber";
  options: readonly SelectOption[];
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MenuPlacement {
  side: "bottom" | "top";
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

export function flattenSelectOptions(sections: readonly SelectSection[]): SelectOption[] {
  const out: SelectOption[] = [];
  for (const s of sections) out.push(...s.options);
  return out;
}

/** Keeps options matching every whitespace-separated token across section label, option label, tag and keywords. */
export function filterSelectSections(
  sections: readonly SelectSection[],
  query: string,
): SelectSection[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...sections];
  const out: SelectSection[] = [];
  for (const s of sections) {
    const group = s.label ?? "";
    const options = s.options.filter((o) => {
      const haystack = `${group} ${o.label} ${o.tag ?? ""} ${o.keywords ?? ""}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
    if (options.length > 0) out.push({ ...s, options });
  }
  return out;
}

/** Steps through `count` items with wraparound; returns -1 when there are no items. */
export function stepSelectIndex(count: number, current: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/**
 * Places a floating select menu below or above its trigger button, clamped inside the viewport.
 */
export function placeSelectMenu(
  trigger: RectLike,
  viewport: { width: number; height: number },
  opts?: { minWidth?: number; maxWidth?: number; align?: "start" | "end"; maxHeight?: number },
): MenuPlacement {
  const margin = 12;
  const gap = 6;
  const cap = opts?.maxHeight ?? 340;
  const width = Math.min(
    Math.max(120, viewport.width - margin * 2),
    Math.min(opts?.maxWidth ?? 440, Math.max(trigger.width, opts?.minWidth ?? trigger.width)),
  );
  const rawLeft = opts?.align === "end" ? trigger.right - width : trigger.left;
  const left = Math.round(
    Math.min(Math.max(margin, rawLeft), Math.max(margin, viewport.width - width - margin)),
  );
  const spaceBelow = viewport.height - trigger.bottom - gap - margin;
  const spaceAbove = trigger.top - gap - margin;
  if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
    return {
      side: "bottom",
      left,
      top: Math.round(trigger.bottom + gap),
      width: Math.round(width),
      maxHeight: Math.max(120, Math.min(cap, Math.floor(spaceBelow))),
    };
  }
  return {
    side: "top",
    left,
    bottom: Math.round(viewport.height - trigger.top + gap),
    width: Math.round(width),
    maxHeight: Math.max(120, Math.min(cap, Math.floor(spaceAbove))),
  };
}
