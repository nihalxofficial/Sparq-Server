/**
 * Merging one section of a profile form into a document.
 *
 * Two form rules live here for both the rider and the vendor file: a key the
 * caller never sent is not touched, and a key whose value already matches is not
 * an edit (so `updatedAt` and the history stay honest).
 */

/**
 * Whether a field really moved.
 *
 * Dates compare as instants, lists compare item by item in order, and anything
 * else compares as text — which is what lets `"15"`, `15` and an untouched
 * empty string all read as the same answer.
 */
export function sameValue(before: unknown, after: unknown): boolean {
  if (before instanceof Date && after instanceof Date) return before.getTime() === after.getTime();
  // The file holds a Date, the picker writes `YYYY-MM-DD` text. Read as the
  // same instant, an untouched birthday is not an edit that deserves a history
  // line; compared as text it would rewrite the row on every single save.
  if (
    before instanceof Date &&
    (typeof after === "string" || typeof after === "number") &&
    String(after).trim() !== ""
  ) {
    const asDate = new Date(after);
    return !isNaN(asDate.getTime()) && before.getTime() === asDate.getTime();
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((item, index) => item === after[index]);
  }
  if (before === after) return true;
  if (before === null || before === undefined) return after === "" || after === null;
  return String(before) === String(after);
}

/**
 * Writes one section of a patch into a hydrated document.
 *
 * Returns whether anything was set, so the caller can decide whether the save
 * deserves a history line. `undefined` values are skipped — "this field was not
 * part of the form" — while `null` and `""` are written, because those are the
 * picker and the text box saying the person cleared the field.
 */
export function applySection(
  doc: any,
  section: string,
  patch?: Record<string, unknown>
): boolean {
  if (!patch) return false;
  const current: Record<string, any> = doc.get(section) || {};
  let changed = false;

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (sameValue(current[key], value)) continue;
    doc.set(`${section}.${key}`, value);
    changed = true;
  }

  return changed;
}
