import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** True when `argv1` names the same file as `metaUrl`, ignoring path case on Windows. */
export function isEntry(
  argv1: string | undefined,
  metaUrl: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!argv1) return false;
  const a = canonical(argv1);
  const b = canonical(fileURLToPath(metaUrl));
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
