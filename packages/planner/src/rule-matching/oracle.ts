import type { KnowledgeNode } from "./types.js";

const SEALED_KINDS = new Set(["hidden_check", "sealed_oracle"]);
const SEALED_VISIBILITY = new Set(["hidden_check", "held_back", "sealed", "sealed_oracle"]);

export function isSealedOracle(
  node: Pick<KnowledgeNode, "hidden" | "kind" | "visibility">,
): boolean {
  if (node.hidden) return true;
  if (SEALED_KINDS.has(node.kind)) return true;
  return SEALED_VISIBILITY.has(node.visibility);
}
