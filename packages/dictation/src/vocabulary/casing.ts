/**
 * Canonical spellings Whisper should emit for common technical names.
 * Applied only when a harvested token differs by case, never by letters.
 */
export const CANONICAL_TECH_TERMS = [
  "PostgreSQL",
  "Playwright",
  "Supabase",
  "MenuItem",
  "Mailpit",
  "Stripe",
  "OAuth",
  "SQLite",
  "Next.js",
  "tRPC",
  "Prisma",
  "Vite",
  "Postgres",
] as const;

const CANONICAL_BY_LOWER = new Map<string, string>(
  CANONICAL_TECH_TERMS.map((term) => [term.toLowerCase(), term]),
);

/** NFC only. Never title-case, lower-case, or rewrite punctuation. */
export function preserveDeveloperCasing(term: string): string {
  return term.normalize("NFC");
}

/**
 * If `term` is the same spelling as a known technical name aside from case,
 * return the canonical casing (`postgresql` → `PostgreSQL`). Otherwise keep
 * the developer's exact casing.
 */
export function canonicalizeTechCasing(term: string): string {
  const preserved = preserveDeveloperCasing(term.trim());
  const canonical = CANONICAL_BY_LOWER.get(preserved.toLowerCase());
  return canonical ?? preserved;
}

export function heardKey(heard: string): string {
  return preserveDeveloperCasing(heard).trim().replace(/\s+/g, " ").toLowerCase();
}
