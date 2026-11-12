export type MatchOptions = {
  /** Case-sensitive comparison. */
  matchCase: boolean
  /** Only whole-word hits count. */
  matchWholeWord: boolean
}

export const DEFAULT_MATCH: MatchOptions = { matchCase: false, matchWholeWord: false }

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Client-side search used by the screens whose endpoint has no server-side
 * matching (hosts, nodes, services). Mirrors the server's `match_case` /
 * `match_whole_word` behaviour so the toggles mean the same thing everywhere.
 */
export function matchesSearch(haystack: string, needle: string, options: MatchOptions): boolean {
  if (!needle.trim()) return true
  if (!options.matchCase && !options.matchWholeWord) {
    return haystack.toLowerCase().includes(needle.toLowerCase())
  }
  const flags = options.matchCase ? "" : "i"
  const pattern = options.matchWholeWord
    ? new RegExp(`\\b${escapeRegExp(needle)}\\b`, flags)
    : new RegExp(escapeRegExp(needle), flags)
  return pattern.test(haystack)
}

/** Convenience for rows with several searchable fields. */
export function matchesAny(values: Array<string | null | undefined>, needle: string, options: MatchOptions) {
  return values.some((value) => matchesSearch(value ?? "", needle, options))
}
