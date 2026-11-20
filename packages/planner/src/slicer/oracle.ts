import { compareText } from "./tokens.js";
import { fieldBool, fieldString, type OracleLeakPreventedAssertion, type SliceEdge, type SliceNode } from "./types.js";

const SEALED_CLASSES = new Set(["hidden_check", "sealed_oracle"]);

export function isSealedOracle(node: Pick<SliceNode, "id" | "kind" | "fields">): boolean {
  if (node.id.startsWith("sealed_oracle") || node.id.startsWith("hidden_check")) return true;
  if (fieldBool(node.fields, "sealed") || fieldBool(node.fields, "hidden")) return true;
  if (fieldString(node.fields, "author") === "oracle-author@1") return true;
  const nodeClass = fieldString(node.fields, "nodeClass");
  if (nodeClass && SEALED_CLASSES.has(nodeClass)) return true;
  if (node.kind === "check" && fieldString(node.fields, "visibility") === "hidden") return true;
  return false;
}

export function leakAssertion(
  node: Pick<SliceNode, "id">,
  edges: readonly SliceEdge[],
): OracleLeakPreventedAssertion {
  const linked = new Set<string>();
  for (const edge of edges) {
    if (edge.src === node.id) linked.add(edge.dst);
    if (edge.dst === node.id) linked.add(edge.src);
  }
  linked.delete(node.id);
  return {
    code: "OracleLeakPreventedAssertion",
    nodeId: node.id,
    linkedTo: [...linked].sort(compareText),
  };
}

export class OracleLeakError extends Error {
  readonly code = "OracleLeakPreventedAssertion" as const;

  constructor(readonly nodeId: string) {
    super(`OracleLeakPreventedAssertion: sealed node ${nodeId} cannot enter a worker brief`);
    this.name = "OracleLeakError";
  }
}
