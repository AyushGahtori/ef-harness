const CASING_VARIANT_ORDER = [
  "pascal",
  "camel",
  "snake",
  "screaming_snake",
  "kebab",
  "plural_snake",
] as const;

export type CasingVariant = (typeof CASING_VARIANT_ORDER)[number];

function splitWords(input: string): string[] {
  const normalized = input
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_.]+/g, " ")
    .trim();
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

function toPascal(words: readonly string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function toCamel(words: readonly string[]): string {
  const pascal = toPascal(words);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toSnake(words: readonly string[]): string {
  return words.map((w) => w.toLowerCase()).join("_");
}

function toScreamingSnake(words: readonly string[]): string {
  return toSnake(words).toUpperCase();
}

function toKebab(words: readonly string[]): string {
  return words.map((w) => w.toLowerCase()).join("-");
}

function pluralizeSnake(snake: string): string {
  if (snake.endsWith("s")) return snake;
  if (snake.endsWith("y") && !snake.endsWith("ay")) {
    return `${snake.slice(0, -1)}ies`;
  }
  if (snake.endsWith("s") || snake.endsWith("x") || snake.endsWith("ch") || snake.endsWith("sh")) {
    return `${snake}es`;
  }
  return `${snake}s`;
}

/**
 * Expands a canonical symbol name into the six sweep-safety naming variants
 * (plus singular/plural snake where applicable).
 */
export function expandNamingVariants(canonical: string): { variant: string; casing: CasingVariant }[] {
  const words = splitWords(canonical);
  if (words.length === 0) return [];

  const pascal = toPascal(words);
  const camel = toCamel(words);
  const snake = toSnake(words);
  const screaming = toScreamingSnake(words);
  const kebab = toKebab(words);
  const pluralSnake = pluralizeSnake(snake);

  return [
    { variant: pascal, casing: "pascal" },
    { variant: camel, casing: "camel" },
    { variant: snake, casing: "snake" },
    { variant: screaming, casing: "screaming_snake" },
    { variant: kebab, casing: "kebab" },
    { variant: pluralSnake, casing: "plural_snake" },
  ];
}

export function uniqueVariants(canonical: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { variant } of expandNamingVariants(canonical)) {
    if (!seen.has(variant)) {
      seen.add(variant);
      out.push(variant);
    }
  }
  return out;
}

export { CASING_VARIANT_ORDER };