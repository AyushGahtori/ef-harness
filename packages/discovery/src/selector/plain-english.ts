const TABLE_LEAK =
  /scope_criteria|discovery_batches|discovery_scopes|work_items|change_sets|node_versions/i;
const RAW_KEY = /\b[a-z][a-z0-9]*(?:\.[a-z0-9_]+){1,}\b/i;
const REGEX_LITERAL = /\/[^/\n]+\/[gimsuy]*/;
const TOKEN = /[a-z0-9_]+/giu;

const WORD: Record<string, string> = {
  auth: "authentication",
  rbac: "access roles",
  mode: "mode",
  session: "session",
  deploy: "deployment",
  deployment: "deployment",
  target: "target",
  data: "data",
  core: "core",
  domain: "domain",
  kitchen: "kitchen",
  cutoff: "cutoff",
  pricing: "pricing",
  product: "product",
  workflow: "workflow",
  workflows: "workflow",
  order: "order",
  orders: "orders",
};

let cachedIds: readonly string[] | null = null;
let cachedGuard: (text: string) => boolean = () => true;

export function isUserFacingClean(text: string, criterionIds: readonly string[]): boolean {
  if (cachedIds !== criterionIds) {
    cachedIds = criterionIds;
    cachedGuard = compileSurfaceGuard(criterionIds);
  }
  return cachedGuard(text);
}

export function compileSurfaceGuard(criterionIds: readonly string[]): (text: string) => boolean {
  const exact = new Set<string>();
  const phrases: string[] = [];
  for (const id of criterionIds) {
    if (id.length === 0) continue;
    const lower = id.toLowerCase();
    if (lower.includes("-") || lower.includes(".")) phrases.push(lower);
    else exact.add(lower);
  }
  return (text: string) => {
    if (TABLE_LEAK.test(text) || RAW_KEY.test(text) || REGEX_LITERAL.test(text)) return false;
    const lower = text.toLowerCase();
    for (const phrase of phrases) {
      if (lower.includes(phrase)) return false;
    }
    if (exact.size === 0) return true;
    TOKEN.lastIndex = 0;
    let match = TOKEN.exec(lower);
    while (match !== null) {
      const token = match[0];
      if (token !== undefined && exact.has(token)) return false;
      match = TOKEN.exec(lower);
    }
    return true;
  };
}

export function safeWhyAsking(label: string, criterionIds: readonly string[]): string {
  const sentence = `Decides ${plainLabel(label, criterionIds)}.`;
  if (isUserFacingClean(sentence, criterionIds)) return sentence;
  return "Decides the next product choice.";
}

export function plainLabel(label: string, criterionIds: readonly string[]): string {
  if (label.trim().length > 0 && isUserFacingClean(label, criterionIds) && !RAW_KEY.test(label)) {
    return label.trim();
  }
  if (RAW_KEY.test(label) || label.includes(".")) {
    const human = humanizeKey(label);
    if (isUserFacingClean(human, criterionIds)) return human;
  }
  return "this product choice";
}

export function cleanOptionLabel(label: string, index: number, criterionIds: readonly string[]): string {
  if (isUserFacingClean(label, criterionIds)) return label;
  return `Choice ${index + 1}`;
}

export function joinAnd(labels: readonly string[]): string {
  if (labels.length === 0) return "this product choice";
  if (labels.length === 1) return labels[0] ?? "this product choice";
  if (labels.length === 2) return `${labels[0] ?? ""} and ${labels[1] ?? ""}`;
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1] ?? "";
  return `${head}, and ${last}`;
}

function humanizeKey(value: string): string {
  const parts = value.split(/[._]+/u).filter((part) => part.length > 0);
  const words = parts.map((part) => WORD[part.toLowerCase()] ?? part.replaceAll("_", " "));
  const sentence = words.join(" ").replace(/\s+/gu, " ").trim();
  if (sentence.length === 0) return "this product choice";
  return sentence;
}
