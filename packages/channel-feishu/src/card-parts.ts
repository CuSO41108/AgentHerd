// Small Feishu card elements that more than one card uses: Markdown, answer buttons and boxes,
// folded long texts. `card.ts` builds whole cards from views; `herd-ui-card.ts` builds the
// elements of a Herder reply's herd-ui fences (ADR 0074). Both take their parts from here.

import { readableMath } from "./math.ts";

export type Element = Record<string, unknown>;

/** Break a ``` sequence inside a code block so it cannot close the fence early. */
export function escapeCodeFence(text: string): string {
  return text.replaceAll("```", "``\u200B`");
}

/** Paths and names stay as typed, not turned into emphasis or links. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]()<>#|])/g, "\\$1");
}

/** A markdown element; TeX math is written as plain text, which Feishu cards can show. */
export function markdown(content: string): Element {
  return { tag: "markdown", content: readableMath(content) };
}

/** A one-button row for a relay/end-relay action with a {target, action} value. */
export function actionRow(target: string, action: string, label: string): Element {
  return {
    tag: "column_set",
    columns: [
      {
        tag: "column",
        width: "auto",
        elements: [
          {
            tag: "button",
            text: { tag: "plain_text", content: label },
            type: "default",
            behaviors: [{ type: "callback", value: { target, action } }],
          },
        ],
      },
    ],
  };
}

/** Longer answers, and any path, do not fit a one-line button on a phone. */
const ANSWER_BUTTON_MAX = 15;

export function fitsButton(label: string): boolean {
  return [...label].length <= ANSWER_BUTTON_MAX && !label.includes("/") && !label.includes("\\");
}

/**
 * A whole-width clickable box for a long answer: Feishu cuts a button to one line, so a path like
 * /Users/me/learnspace/PI-Desktop lost the part that tells two folders apart. The box wraps the
 * full text and sends the same {target, action} as a button.
 */
export function answerBox(target: string, action: string, label: string): Element {
  return {
    tag: "interactive_container",
    width: "fill",
    has_border: true,
    border_color: "grey",
    corner_radius: "8px",
    padding: "8px 12px 8px 12px",
    behaviors: [{ type: "callback", value: { target, action } }],
    elements: [{ tag: "markdown", content: escapeMarkdown(label) }],
  };
}

/** One answer: a button when it fits on one line, else a box with the whole text. */
export function answerElement(target: string, action: string, label: string): Element {
  return fitsButton(label) ? actionRow(target, action, label) : answerBox(target, action, label);
}

/** Maximum body length shown before a report body is folded. */
export const FOLD_CHARS = 400;

/** Shorten a long body, cutting at the last newline after position 200 when possible. */
export function foldBody(body: string): string {
  const prefix = body.slice(0, FOLD_CHARS);
  const lastNewline = prefix.lastIndexOf("\n");
  if (lastNewline > 200) {
    return body.slice(0, lastNewline);
  }
  return prefix;
}

/** A folded panel (e.g. "Show all") wrapping a markdown element. */
export function collapsiblePanel(title: string, content: string): Element {
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: { title: markdown(title) },
    elements: [markdown(content)],
  };
}

/** A text as markdown; a long one shows its start, with the whole text in a folded panel. */
export function foldedMarkdown(text: string, showAll: string): Element[] {
  if (text.length <= FOLD_CHARS) return [markdown(text)];
  return [markdown(`${foldBody(text)}…`), collapsiblePanel(showAll, text)];
}
