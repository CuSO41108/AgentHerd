// A Herder reply with generated UI (ADR 0074), as the pet draws it: its Markdown and its fences in
// order, the answers of its choices numbered across the whole reply. Pure functions, so they are
// easy to test.

import {
  type HerdUiSpec,
  hasHerdUi,
  herdUiChoices,
  splitHerdUi,
} from "@agentherd/protocol/herd-ui";
import { foldOf } from "./pet-state";

/** A part of a reply: Markdown, or a fence's components with the number of its first answer. */
export type ReplyPart =
  | { kind: "markdown"; text: string }
  | { kind: "ui"; spec: HerdUiSpec; firstAction: number };

/** How many answers a fence offers, over all its `choices`. */
export function answersIn(spec: HerdUiSpec): number {
  return spec.items.reduce((n, node) => n + (node.type === "choices" ? node.options.length : 0), 0);
}

/**
 * A reply cut into what the pet draws, in order. Fences nothing could be read from are left out.
 * Answers are numbered across all fences, as `herdUiChoices` numbers them.
 */
export function replyParts(text: string): ReplyPart[] {
  if (!hasHerdUi(text)) return text.trim() === "" ? [] : [{ kind: "markdown", text }];
  const out: ReplyPart[] = [];
  let next = 0;
  for (const s of splitHerdUi(text)) {
    if (s.kind === "markdown") out.push({ kind: "markdown", text: s.text });
    else if (s.kind === "ui") {
      out.push({ kind: "ui", spec: s.spec, firstAction: next });
      next += answersIn(s.spec);
    }
  }
  return out;
}

/** For each component of a fence, the number of its first answer; only `choices` have one. */
export function choiceStarts(spec: HerdUiSpec, firstAction: number): (number | undefined)[] {
  let next = firstAction;
  return spec.items.map((node) => {
    if (node.type !== "choices") return undefined;
    const start = next;
    next += node.options.length;
    return start;
  });
}

/** The reply's own words: its Markdown without the fences. */
export function replyMarkdown(text: string): string {
  if (!hasHerdUi(text)) return text;
  return splitHerdUi(text)
    .flatMap((s) => (s.kind === "markdown" ? [s.text] : []))
    .join("\n\n");
}

/** A reply with fences is never folded: folding would hide its components and its buttons. */
export function replyFold(text: string): { folded: boolean; more: number } {
  return hasHerdUi(text) ? { folded: false, more: 0 } : foldOf(text);
}

/** Whether the picked answer is one of the reply's choices (else it is shown on its own). */
export function offersAnswer(text: string, chosen: string): boolean {
  return herdUiChoices(text).some((c) => c.label === chosen);
}

/** The site of a link, without "www.": what a link card shows under its title. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Tiles in a row of `stats`: all in one row up to three, two rows of two for four. */
export function statColumns(count: number): number {
  if (count <= 3) return Math.max(1, count);
  return count === 4 ? 2 : 3;
}
