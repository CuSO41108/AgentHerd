// Small platform helpers for the renderer (no Node access).

/** True when running on macOS (controls traffic-light frame layout and Mac copy). */
export function isMac(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean {
  return userAgent.includes("Mac");
}

/** Last non-empty path segment of a POSIX or Windows path. */
export function pathLeaf(path: string): string | undefined {
  return path.split(/[/\\]/).filter(Boolean).at(-1);
}

/** True when a failed agent check looks like an OS or security-software block on Windows. */
export function isAgentSecurityBlock(error: string | undefined): boolean {
  if (error === undefined) return false;
  return /\b(?:EPERM|EACCES)\b|access is denied|contains a virus/i.test(error);
}
