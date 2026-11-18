// Opening a file a message names, from the pet (ADR 0073). The pet's page asks with a path; main
// decides. Only files that just show something are opened in their app; anything else (a script,
// an app, a folder of unknown things) is only shown in Finder, so a message can never run code.

import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/** Kinds that open in a viewer: text, documents, pictures, data. */
const VIEWABLE = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".docx",
  ".xlsx",
  ".pptx",
]);

export interface FileToOpen {
  path: string;
  /** "open" in its app, or only "reveal" it in Finder. */
  how: "open" | "reveal";
}

/**
 * What to do with a path from a message: undefined when it is not a file on this Mac.
 * @param raw an absolute path or one starting with ~/
 * @param isFile whether a regular file exists there
 */
export function fileToOpen(
  raw: unknown,
  isFile: (path: string) => boolean,
  home = homedir(),
): FileToOpen | undefined {
  if (typeof raw !== "string" || raw === "" || raw.length > 4096 || raw.includes("\0")) {
    return undefined;
  }
  const isWin =
    /^[A-Za-z]:[\\/]/.test(raw) ||
    raw.startsWith("~\\") ||
    /^[A-Za-z]:[\\/]/.test(home) ||
    home.includes("\\");
  const p = isWin ? win32 : posix;
  const expanded = raw.startsWith("~/") || raw.startsWith("~\\") ? p.join(home, raw.slice(2)) : raw;
  if (!p.isAbsolute(expanded)) return undefined;
  const path = p.normalize(expanded);
  if (!isFile(path)) return undefined;
  return { path, how: VIEWABLE.has(p.extname(path).toLowerCase()) ? "open" : "reveal" };
}
