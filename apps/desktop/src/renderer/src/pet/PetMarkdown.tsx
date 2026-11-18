// The Herder's words in the pet as Markdown (ADR 0073), drawn as React elements from the app's own
// parser: no HTML from a message ever reaches the page. Links open in the browser (main decides).

import type { ReactNode } from "react";
import { type Block, type Inline, parseInline, parseMarkdown } from "../markdown";

function inlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${i}-${n.kind}`;
    switch (n.kind) {
      case "text":
        return n.text;
      case "break":
        return <br key={key} />;
      case "code":
        return <code key={key}>{n.text}</code>;
      case "strong":
        return <strong key={key}>{inlines(n.children)}</strong>;
      case "em":
        return <em key={key}>{inlines(n.children)}</em>;
      case "del":
        return <del key={key}>{inlines(n.children)}</del>;
      case "link":
        return (
          <a key={key} href={n.href} target="_blank" rel="noreferrer" title={n.href}>
            {inlines(n.children)}
          </a>
        );
      default:
        return null;
    }
  });
}

function Text({ text }: { text: string }) {
  return <>{inlines(parseInline(text))}</>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      return (
        <p className="pet-md-h">
          <Text text={block.text} />
        </p>
      );
    case "paragraph":
      return (
        <p>
          <Text text={block.text} />
        </p>
      );
    case "code":
      return (
        <div className="pet-md-pre">
          <pre className="pet-code">{block.text}</pre>
        </div>
      );
    case "rule":
      return <hr />;
    case "quote":
      return (
        <blockquote>
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items have no id and never reorder
        <li key={i} className={item.checked === undefined ? undefined : "pet-md-check"}>
          {item.checked !== undefined && (
            <span aria-hidden="true">{item.checked ? "☑ " : "☐ "}</span>
          )}
          <Text text={item.text} />
          {item.children.length > 0 && <Blocks blocks={item.children} />}
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start === 1 ? undefined : block.start}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }
    case "table":
      return (
        <div className="pet-md-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                  <th key={i} style={{ textAlign: block.align[i] }}>
                    <Text text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <tr key={r}>
                  {row.map((cell, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                    <td key={i} style={{ textAlign: block.align[i] }}>
                      <Text text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional and re-parsed as a whole
        <BlockView key={i} block={b} />
      ))}
    </>
  );
}

/** One line of inline Markdown (bold, code, links…), styled as the messages are. */
export function PetInline({ text }: { text: string }) {
  return (
    <span className="pet-md">
      <Text text={text} />
    </span>
  );
}

/** A message rendered as Markdown. */
export function PetMarkdown({ text }: { text: string }) {
  return (
    <div className="pet-md">
      <Blocks blocks={parseMarkdown(text)} />
    </div>
  );
}
