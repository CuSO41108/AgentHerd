// Generated UI in the pet (ADR 0074): the components of a reply's ```herd-ui fence drawn as React
// elements in the pet's look. Words in them go through the pet's Markdown, never as HTML. Choices
// answer for the owner while their card is open, as a tap in Feishu does.

import type { HerdUiNode, HerdUiSpec } from "@agentherd/protocol/herd-ui";
import { choiceStarts, hostOf, statColumns } from "./herd-ui-state";
import { PetInline, PetMarkdown } from "./PetMarkdown";
import { PetPicture } from "./PetPicture";

type Of<T extends HerdUiNode["type"]> = Extract<HerdUiNode, { type: T }>;

/** What a reply's choices are bound to: the card it came as. */
export interface ChoiceBinding {
  /** The card still takes an answer. */
  open: boolean;
  /** The answer the owner picked; then no button works and this one is marked. */
  chosen?: string | undefined;
  /** Buttons wait (another press is on its way, or AgentHerd is offline). */
  disabled?: boolean;
  /** Answers with the answer's number across the whole reply ("0", "1", …). */
  press(action: string): void;
}

/** A file with a button that opens it (or shows it in Finder): the chip under messages. */
export function FileChip(props: {
  path: string;
  name: string;
  sub: string;
  openFile(path: string): void;
}) {
  return (
    <button
      type="button"
      className="pet-file"
      title={props.path}
      onClick={() => props.openFile(props.path)}
    >
      <span className="pet-file-icon" aria-hidden="true">
        📄
      </span>
      <span className="pet-file-name">
        <b>{props.name}</b>
        <small>{props.sub}</small>
      </span>
      <span className="pet-file-open">打开</span>
    </button>
  );
}

function Table({ node }: { node: Of<"table"> }) {
  const last = node.rows.length - 1;
  return (
    <div className="pet-ui-table">
      <table className="pet-ui-grid">
        <thead>
          <tr>
            {node.columns.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              <th key={i} className="pet-ui-th">
                <PetInline text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            <tr key={r}>
              {row.map((cell, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                <td key={i} className={r === last ? "pet-ui-td last" : "pet-ui-td"}>
                  <PetInline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValue({ node }: { node: Of<"keyvalue"> }) {
  return (
    <div className="pet-ui-kv">
      {node.pairs.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: pairs are positional and keys may repeat
        <div key={i} className="pet-ui-kv-row">
          <span className="pet-ui-kv-key">{p.key}</span>
          <span className="pet-ui-kv-value">
            <PetInline text={p.value} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Stats({ node }: { node: Of<"stats"> }) {
  const columns = statColumns(node.items.length);
  return (
    <div
      className="pet-ui-stats"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {node.items.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tiles are positional
        <div key={i} className="pet-ui-stat">
          <span className="pet-ui-stat-value">{s.value}</span>
          <span className="pet-ui-stat-label">{s.label}</span>
          {s.hint !== undefined && <span className="pet-ui-stat-hint">{s.hint}</span>}
        </div>
      ))}
    </div>
  );
}

function Steps({ node }: { node: Of<"steps"> }) {
  const last = node.steps.length - 1;
  return (
    <div className="pet-ui-steps">
      {node.steps.map((s, i) => {
        const status = s.status ?? "todo";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
          <div key={i} className="pet-ui-step">
            <span className="pet-ui-step-mark">
              <span className={`pet-ui-step-dot ${status}`} aria-hidden="true">
                {status === "done" ? "✓" : ""}
              </span>
              {i < last && <span className={`pet-ui-step-rail ${status}`} aria-hidden="true" />}
            </span>
            <span className="pet-ui-step-body">
              <span className={`pet-ui-step-title ${status}`}>
                <PetInline text={s.title} />
              </span>
              {s.desc !== undefined && (
                <span className="pet-ui-step-desc">
                  <PetInline text={s.desc} />
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function List({ node }: { node: Of<"list"> }) {
  const items = node.items.map((x, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: items are positional
    <li key={i} className="pet-ui-li">
      <PetInline text={x} />
    </li>
  ));
  return node.ordered === true ? (
    <ol className="pet-ui-list">{items}</ol>
  ) : (
    <ul className="pet-ui-list">{items}</ul>
  );
}

const TONE_ICON: Record<Of<"callout">["tone"], string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

function Callout({ node }: { node: Of<"callout"> }) {
  return (
    <div className={`pet-ui-callout ${node.tone}`}>
      <span className="pet-ui-callout-icon" aria-hidden="true">
        {TONE_ICON[node.tone]}
      </span>
      <div className="pet-ui-callout-body">
        {node.title !== undefined && <div className="pet-ui-callout-title">{node.title}</div>}
        {node.content !== "" && <PetMarkdown text={node.content} />}
      </div>
    </div>
  );
}

function Code({ node }: { node: Of<"code"> }) {
  return (
    <div className="pet-ui-code">
      {node.lang !== undefined && <span className="pet-ui-code-lang">{node.lang}</span>}
      <pre className="pet-code">{node.code}</pre>
    </div>
  );
}

function LinkCard({ node }: { node: Of<"link"> }) {
  // The parser keeps only http(s) links; checked again, as this becomes an href.
  if (!/^https?:\/\//i.test(node.url)) return null;
  const host = hostOf(node.url);
  return (
    <a className="pet-ui-link" href={node.url} target="_blank" rel="noreferrer" title={node.url}>
      <span className="pet-ui-link-title">{node.title}</span>
      {node.desc !== undefined && <span className="pet-ui-link-desc">{node.desc}</span>}
      <span className="pet-ui-link-foot">
        <span className="pet-ui-link-host">{host === "" ? node.url : host} ↗</span>
        {node.meta !== undefined && <span className="pet-ui-link-meta">{node.meta}</span>}
      </span>
    </a>
  );
}

function FileCard({ node, openFile }: { node: Of<"file">; openFile(path: string): void }) {
  const cut = Math.max(node.path.lastIndexOf("/"), node.path.lastIndexOf("\\"));
  const name = node.title ?? node.path.slice(cut + 1);
  const sub =
    node.desc ?? (node.title === undefined ? (cut >= 0 ? node.path.slice(0, cut) : "") : node.path);
  return <FileChip path={node.path} name={name} sub={sub} openFile={openFile} />;
}

/**
 * A picture the Herder shows as an `image` item (ADR 0075): drawn like a Markdown image, with
 * its title and description as a quiet line under it.
 */
function ImageItem({ node }: { node: Of<"image"> }) {
  const caption = [node.title, node.desc].filter((x) => x !== undefined && x !== "").join(" · ");
  return (
    <div className="pet-ui-picture">
      <PetPicture path={node.path} alt={node.title ?? ""} />
      {caption !== "" && <div className="pet-ui-picture-caption">{caption}</div>}
    </div>
  );
}

function Choices(props: {
  node: Of<"choices">;
  start: number;
  choices?: ChoiceBinding | undefined;
}) {
  const { node, start, choices } = props;
  const chosen = choices?.chosen;
  const live = choices?.open === true && chosen === undefined;
  const picked = chosen !== undefined && node.options.includes(chosen);
  return (
    <div className="pet-ui-choices">
      {node.question !== undefined && <div className="pet-ui-question">{node.question}</div>}
      <div className="pet-ui-answers">
        {node.options.map((label, i) => {
          const mine = label === chosen;
          const look = mine ? " chosen" : live && i === 0 ? " primary" : "";
          return (
            <button
              key={label}
              type="button"
              className={`pet-ui-answer${look}`}
              disabled={!live || choices?.disabled === true}
              aria-pressed={chosen === undefined ? undefined : mine}
              onClick={() => choices?.press(String(start + i))}
            >
              {mine && "✓ "}
              {label}
            </button>
          );
        })}
      </div>
      {picked && <div className="pet-ui-chosen">你选了：{chosen}</div>}
    </div>
  );
}

function Divider({ node }: { node: Of<"divider"> }) {
  return (
    <div className="pet-ui-divider">
      {node.label !== undefined && <span className="pet-ui-divider-label">{node.label}</span>}
    </div>
  );
}

function NodeView(props: {
  node: HerdUiNode;
  start: number | undefined;
  choices?: ChoiceBinding | undefined;
  openFile(path: string): void;
}) {
  const { node } = props;
  switch (node.type) {
    case "text":
      return <PetMarkdown text={node.content} />;
    case "table":
      return <Table node={node} />;
    case "keyvalue":
      return <KeyValue node={node} />;
    case "stats":
      return <Stats node={node} />;
    case "steps":
      return <Steps node={node} />;
    case "list":
      return <List node={node} />;
    case "callout":
      return <Callout node={node} />;
    case "code":
      return <Code node={node} />;
    case "link":
      return <LinkCard node={node} />;
    case "file":
      return <FileCard node={node} openFile={props.openFile} />;
    case "image":
      return <ImageItem node={node} />;
    case "choices":
      return <Choices node={node} start={props.start ?? 0} choices={props.choices} />;
    case "divider":
      return <Divider node={node} />;
  }
}

/**
 * The components of one fence. `firstAction` is the number of its first answer in the whole
 * reply. Without `choices` (a line of history, not a card) the answers show but do not work.
 */
export function HerdUiView(props: {
  spec: HerdUiSpec;
  firstAction: number;
  choices?: ChoiceBinding | undefined;
  openFile(path: string): void;
}) {
  const { spec } = props;
  const starts = choiceStarts(spec, props.firstAction);
  return (
    <div className="pet-ui">
      {spec.title !== undefined && <div className="pet-ui-title">{spec.title}</div>}
      {spec.items.map((node, i) => (
        <NodeView
          // biome-ignore lint/suspicious/noArrayIndexKey: components are positional
          key={i}
          node={node}
          start={starts[i]}
          choices={props.choices}
          openFile={props.openFile}
        />
      ))}
    </div>
  );
}
