import { uniqueSorted } from "../text.js";

/**
 * Local port of Task 077 `EntityTagInheritor`.
 * The sibling returns `inheritedTags` on task, endpoint, and screen nodes.
 * Entity tag `pii` is the corpus tag `personal_data`.
 */
export interface EntityInheritanceNode {
  readonly id: string;
  readonly inheritedTags: readonly string[];
}

export interface EntityTagInheritorPort {
  inherit(snapshot: unknown): { readonly nodes: readonly EntityInheritanceNode[] };
}

const ENTITY_TAG_ALIASES: Readonly<Record<string, string>> = {
  pii: "personal_data",
};

export function normalizeEntityTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    normalized.push(ENTITY_TAG_ALIASES[trimmed] ?? trimmed);
  }
  return uniqueSorted(normalized);
}

export function inheritedTagsForTask(
  report: { readonly nodes: readonly EntityInheritanceNode[] },
  taskId: string,
): string[] {
  const node = report.nodes.find((item) => item.id === taskId);
  return normalizeEntityTags(node?.inheritedTags ?? []);
}
