// How to start Pi. npm/pnpm install `pi` as a `#!/usr/bin/env node` script or a `.cmd` shim on
// Windows; an app opened from Finder/Start menu may have no `node` on PATH, so such a script runs
// with this process's Node.

import { closeSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { npmShimTarget } from "@agentherd/acp-client";

const BATCH = /\.(cmd|bat)$/i;

function firstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(200);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
  } finally {
    closeSync(fd);
  }
}

/**
 * @param bin Path to `pi` (a symlink to the npm script, a `.cmd` shim, or a native binary).
 * @param node The Node binary to run a Node script with.
 * @returns The command line that starts Pi.
 */
export function piCommand(
  bin: string,
  node: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string[] {
  let real: string;
  try {
    real = realpathSync(bin);
  } catch {
    return [bin];
  }
  if (platform === "win32" && BATCH.test(real)) {
    try {
      const target = npmShimTarget(real, readFileSync(real, "utf8"));
      if (target !== undefined) return [node, target];
    } catch {
      // Not readable: let spawn report it.
    }
    return [real];
  }
  try {
    const line = firstLine(real);
    if (line.startsWith("#!") && /\bnode\b/.test(line)) return [node, real];
  } catch {
    // Not readable: let spawn report it.
  }
  return [real];
}
