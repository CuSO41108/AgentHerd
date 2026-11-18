// The pieces of the pet's conversation (ADR 0073): the Herder's replies as Markdown with the files
// they name, the owner's bubbles, a task's events as quiet rows, time lines, and the header.

import type { PetLine } from "@agentherd/host/api";
import { useState } from "react";
import { PetMarkdown } from "./PetMarkdown";
import { clockOf, eventOf, filesIn, foldOf, historyHead } from "./pet-state";

/** A file the message names, with a button that opens it (or shows it in Finder). */
function FileChips({ text, openFile }: { text: string; openFile(path: string): void }) {
  const files = filesIn(text);
  if (files.length === 0) return null;
  return (
    <div className="pet-files">
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          className="pet-file"
          title={f.path}
          onClick={() => openFile(f.path)}
        >
          <span className="pet-file-icon" aria-hidden="true">
            📄
          </span>
          <span className="pet-file-name">
            <b>{f.name}</b>
            <small>{f.dir}</small>
          </span>
          <span className="pet-file-open">打开</span>
        </button>
      ))}
    </div>
  );
}

/** A reply of the Herder: no bubble, Markdown, long ones folded behind 「展开全文」. */
function HerderReply(props: { line: PetLine; openFile(path: string): void }) {
  const { line } = props;
  const [all, setAll] = useState(false);
  const { folded, more } = foldOf(line.text);
  const closed = folded && !all;
  const bad = line.kind === "error";
  const head = historyHead(line);
  return (
    <div className={`pet-reply${bad ? " bad" : ""}`} title={clockOf(line.at)}>
      {head !== undefined && <span className="pet-from">📋 {head}</span>}
      <div className={closed ? "pet-folded" : undefined}>
        <PetMarkdown text={line.text} />
      </div>
      {folded && (
        <button type="button" className="pet-more" onClick={() => setAll((x) => !x)}>
          {all ? "收起" : more > 0 ? `展开全文 · 还有 ${more} 行` : "展开全文"}
        </button>
      )}
      <FileChips text={line.text} openFile={props.openFile} />
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
