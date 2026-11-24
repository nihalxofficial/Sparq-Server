import { escapeRegex } from "./regex";

/**
 * A case-insensitive `$or` over the given text fields, with the term escaped.
 * A 24-character hex term also matches the given id fields, so a pasted id
 * finds its own record.
 */
export function searchOr(
  textFields: string[],
  term: string,
  idFields: string[] = []
): { $or: Record<string, unknown>[] } {
  const query = term.trim();
  const safe = escapeRegex(query);
  const clauses: Record<string, unknown>[] = textFields.map((field) => ({
    [field]: { $regex: safe, $options: "i" },
  }));

  if (idFields.length > 0 && /^[0-9a-fA-F]{24}$/.test(query)) {
    for (const field of idFields) clauses.push({ [field]: query });
  }

  return { $or: clauses };
}
