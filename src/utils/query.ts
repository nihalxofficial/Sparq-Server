import { searchOr } from "./search";

export { searchOr };

/** Named sort orders, e.g. { newest: { createdAt: -1 } }. */
export type SortSpec = Record<string, Record<string, 1 | -1>>;

/** Picks a named sort, falls back, and always ties on `_id` so pages stay stable. */
export function sortBy(
  key: string | undefined,
  spec: SortSpec,
  fallback: Record<string, 1 | -1>
): Record<string, 1 | -1> {
  const chosen = (key && spec[key]) || fallback;
  return { ...chosen, _id: -1 };
}

/** `{ field: { $gte, $lte } }` from optional bounds, or null when both are absent. */
export function range(field: string, min?: number, max?: number) {
  if (min == null && max == null) return null;
  const bounds: Record<string, number> = {};
  if (min != null) bounds.$gte = min;
  if (max != null) bounds.$lte = max;
  return { [field]: bounds };
}

/** `{ field: { $in } }` when values are present, else null. */
export function anyOf(field: string, values?: readonly unknown[]) {
  return values && values.length ? { [field]: { $in: values } } : null;
}

/** Merges filter fragments, dropping the null ones. */
export function where(...parts: (Record<string, unknown> | null | undefined)[]) {
  return Object.assign({}, ...parts.filter(Boolean));
}

/** The paging numbers every list returns. */
export type Page = { items: any[]; total: number; page: number; limit: number; pages: number };

/** A query that can be skipped and limited (a Mongoose Query satisfies this). */
type PageQuery = {
  skip(count: number): PageQuery;
  limit(count: number): any;
};

/** Runs a sorted page query and its count together. */
export async function paginate(
  build: () => PageQuery,
  count: () => Promise<number>,
  page: number,
  limit: number
): Promise<Page> {
  const [items, total] = await Promise.all([
    build().skip((page - 1) * limit).limit(limit),
    count(),
  ]);
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}