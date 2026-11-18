// Opening a file a message names, from the pet (ADR 0073), and reading a picture the Herder
// shows (ADR 0075). The pet's page asks with a path; main decides. Only files that just show something are opened in their app; anything else (a script,
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

function resolvePetPath(raw: unknown, home: string): { path: string; ext: string } | undefined {
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
  return { path, ext: p.extname(path).toLowerCase() };
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
  const resolved = resolvePetPath(raw, home);
  if (resolved === undefined || !isFile(resolved.path)) return undefined;
  return { path: resolved.path, how: VIEWABLE.has(resolved.ext) ? "open" : "reveal" };
}

/** The pet shows pictures up to this size (ADR 0075); Feishu takes the same. */
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;

const PICTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** What a picture file is, from its first bytes; undefined when they are not a picture. */
export function pictureMime(data: Uint8Array): string | undefined {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45) return "image/webp";
  return undefined;
}

/** What `pictureToShow` needs from the disk. */
export interface PictureDisk {
  /** Size of the regular file at the path, or undefined when there is none. */
  fileSize(path: string): number | undefined;
  read(path: string): Uint8Array;
}

/**
 * A picture the Herder shows in the pet (ADR 0075), as a data URL the pet's page can draw (its
 * policy allows data: images and nothing from disk). Only a full path (or ~/…) to a regular
 * png, jpeg, gif or webp file up to `PICTURE_MAX_BYTES` whose bytes are that picture; anything
 * else is undefined, and the pet names the file instead.
 */
export function pictureToShow(
  raw: unknown,
  disk: PictureDisk,
  home = homedir(),
): string | undefined {
  const resolved = resolvePetPath(raw, home);
  if (resolved === undefined || !PICTURE_EXTENSIONS.has(resolved.ext)) return undefined;
  const size = disk.fileSize(resolved.path);
  if (size === undefined || size === 0 || size > PICTURE_MAX_BYTES) return undefined;
  const data = disk.read(resolved.path);
  const mime = pictureMime(data);
  if (mime === undefined) return undefined;
  return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
}
