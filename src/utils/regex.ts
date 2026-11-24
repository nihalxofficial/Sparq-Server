/**
 * Escapes the characters MongoDB's regex engine treats as special, so a search
 * term is matched literally. Without this, a term such as `(a+)+$` becomes a
 * pattern a caller controls — a way to slow the database down or to match more
 * than they typed.
 */
export function escapeRegex(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
