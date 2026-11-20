import { canonicalJson, sha256 } from "./canonical.js";
import type { GraphNode, NodeKind } from "./types.js";

export function makeNode(input: {
  id: string;
  kind: NodeKind;
  title: string;
  text: string;
  fields: Record<string, unknown>;
}): GraphNode {
  const text = input.text.trim();
  const fields = input.fields;
  return {
    id: input.id,
    kind: input.kind,
    version: 1,
    title: input.title,
    text,
    fields,
    status: "active",
    contentHash: sha256(
      canonicalJson({
        kind: input.kind,
        title: input.title,
        text,
        fields,
      }),
    ),
  };
}
