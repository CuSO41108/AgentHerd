export interface GlobOptions {
  caseInsensitive?: boolean;
}

/** Full-string match where `*` matches any characters (including none). No other syntax. */
export function globMatch(pattern: string, text: string, options?: GlobOptions): boolean {
  const p = options?.caseInsensitive ? pattern.toLowerCase() : pattern;
  const t = options?.caseInsensitive ? text.toLowerCase() : text;
  const parts = p.split("*");
  const first = parts[0] as string;
  if (parts.length === 1) return p === t;
  if (!t.startsWith(first)) return false;
  const last = parts[parts.length - 1] as string;
  if (t.length - first.length < last.length || !t.endsWith(last)) return false;
  let pos = first.length;
  const end = t.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    const found = t.indexOf(part, pos);
    if (found === -1 || found + part.length > end) return false;
    pos = found + part.length;
  }
  return true;
}
