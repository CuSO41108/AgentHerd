// The pieces of the pet's conversation (ADR 0073): the Herder's replies as Markdown with the
// components of their herd-ui fences (ADR 0074), the owner's bubbles, a task's events as quiet
// rows, time lines, and the header. A file gets an 打开 button only when the Herder put it in a
// herd-ui `file` item; a path in its words is just text (it judges which files matter).

import type { PetLine } from "@agentherd/host/api";
import { useLayoutEffect, useRef, useState } from "react";
import { type ChoiceBinding, HerdUiView } from "./HerdUi";
import { offersAnswer, replyFold, replyParts } from "./herd-ui-state";
import { PetMarkdown } from "./PetMarkdown";
import { clockOf, eventOf, historyHead } from "./pet-state";

/**
 * The text of a Herder reply: its Markdown, the components of its herd-ui fences in between (their
 * answers numbered across the whole reply). A long reply folds behind 「展开全文」 and 收起 folds it
 * again, components or not; one whose answers are still open does not. `choices` binds the answers
 * to the card the reply came as.
 */
export function ReplyBody(props: {
  text: string;
  choices?: ChoiceBinding | undefined;
  openFile(path: string): void;
}) {
  const { text, choices } = props;
  const [all, setAll] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // The drawn height decides too (pictures and components are tall in few words). Measured before
  // paint and again when it grows (a picture loads); a folded body keeps its box, so read scrollHeight.
  useLayoutEffect(() => {
    const el = body.current;
    if (el === null) return;
    const measure = () => setHeight(el.scrollHeight);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const chosen = choices?.chosen;
  const wait = choices?.open === true && chosen === undefined;
  const { folded, more } = replyFold(text, height, wait);
  const closed = folded && !all;
  // An answer that is not among the buttons (typed instead) is still said.
  const loose = chosen !== undefined && !offersAnswer(text, chosen);
  return (
    <>
      <div ref={body} className={closed ? "pet-reply-body pet-folded" : "pet-reply-body"}>
        {replyParts(text).map((part, i) =>
          part.kind === "markdown" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and re-read as a whole
            <PetMarkdown key={i} text={part.text} />
          ) : (
            <HerdUiView
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and re-read as a whole
              key={i}
              spec={part.spec}
              firstAction={part.firstAction}
              choices={choices}
              openFile={props.openFile}
            />
          ),
        )}
        {loose && <div className="pet-ui-chosen">你选了：{chosen}</div>}
      </div>
      {folded && (
        <button type="button" className="pet-more" onClick={() => setAll((x) => !x)}>
          {all ? "收起" : more > 0 ? `展开全文 · 还有 ${more} 行` : "展开全文"}
        </button>
      )}
    </>
  );
}

/** A reply of the Herder: no bubble, Markdown and components, long ones folded. */
function HerderReply(props: { line: PetLine; openFile(path: string): void }) {
  const { line } = props;
  const bad = line.kind === "error";
  const head = historyHead(line);
  return (
    <div className={`pet-reply${bad ? " bad" : ""}`} title={clockOf(line.at)}>
      {head !== undefined && <span className="pet-from">📋 {head}</span>}
      <ReplyBody text={line.text} openFile={props.openFile} />
    </div>
  );
}

/**
 * A task's event the Herder was told about, as a quiet row: 「task · what happened」, one line
 * until clicked (events are often a command the agent ran).
 */
function EventRow({ line }: { line: PetLine }) {
  const [all, setAll] = useState(false);
  const e = eventOf(line.text);
  return (
    <button
      type="button"
      className={`pet-sys${all ? " all" : ""}`}
      title={all ? undefined : line.text}
      onClick={() => setAll((x) => !x)}
    >
      <span className="pet-sys-dot" aria-hidden="true" />
      <span className="pet-sys-text">
        {e.task !== undefined && <em>{e.task}</em>}
        {e.task !== undefined && " · "}
        {e.text}
      </span>
      <span className="pet-sys-time">{clockOf(line.at)}</span>
    </button>
  );
}

/** One line of the conversation as its kind is drawn. */
export function LineView(props: { line: PetLine; openFile(path: string): void }) {
  const { line } = props;
  if (line.kind === "owner") {
    return (
      <div className="pet-me" title={clockOf(line.at)}>
        {line.text}
      </div>
    );
  }
  if (line.kind === "task") return <EventRow line={line} />;
  return <HerderReply line={line} openFile={props.openFile} />;
}

/** The time line between entries (「今天 11:43」). */
export function Separator({ text }: { text: string }) {
  return <div className="pet-day">{text}</div>;
}
