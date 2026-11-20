import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeNodeContentHash } from "../../src/views-export/canonical-hash.js";
import {
  MemoryKnowledgeViewSource,
  type NodeStatus,
  type ViewEdge,
  type ViewNode,
} from "../../src/views-export/knowledge-graph-port.js";

export function viewNode(input: {
  id: string;
  kind: string;
  title: string;
  text?: string;
  feature?: string | null;
  fields?: Record<string, unknown>;
  version?: number;
  updatedRev?: number;
  status?: NodeStatus;
  basis?: string | null;
  ownerRole?: string | null;
}): ViewNode {
  const text = input.text ?? "";
  const fields = input.fields ?? {};
  const version = input.version ?? 1;
  const updatedRev = input.updatedRev ?? 1;
  return {
    id: input.id,
    kind: input.kind,
    version,
    contentHash: computeNodeContentHash({ kind: input.kind, title: input.title, text, fields }),
    title: input.title,
    text,
    fields,
    status: input.status ?? "active",
    feature: input.feature === undefined ? null : input.feature,
    basis: input.basis === undefined ? "explicit" : input.basis,
    ownerRole: input.ownerRole === undefined ? "planner" : input.ownerRole,
    createdRev: 1,
    updatedRev,
  };
}

export function sampleSource(): MemoryKnowledgeViewSource {
  const source = new MemoryKnowledgeViewSource();
  source.upsertNode(viewNode({ id: "F-Orders", kind: "feature", title: "Orders", feature: "orders", text: "Order feature." }));
  source.upsertNode(
    viewNode({
      id: "R17",
      kind: "rule",
      title: "Cutoff",
      feature: "orders",
      text: "Cutoff is 11:00.",
      fields: { touches: ["orders", "billing"], bounds: { max: 11, min: 0 }, basis: "explicit" },
    }),
  );
  source.upsertNode(viewNode({ id: "D1", kind: "decision", title: "Ship weekly", text: "We ship weekly." }));
  source.upsertNode(
    viewNode({
      id: "D2",
      kind: "decision",
      title: "Earlier decision",
      text: "Shown first.",
      fields: { display_order: 1 },
    }),
  );
  source.upsertNode(
    viewNode({
      id: "D0",
      kind: "decision",
      title: "Later decision",
      text: "Shown second.",
      fields: { display_order: 2 },
    }),
  );
  source.upsertNode(viewNode({ id: "C014", kind: "contract", title: "Orders API", text: "POST /orders", feature: "orders" }));
  source.upsertNode(
    viewNode({
      id: "S-Orders",
      kind: "arch_node",
      title: "Orders screen",
      text: "List of orders.",
      feature: "orders",
      fields: { role: "screen", screen_slug: "orders" },
    }),
  );
  source.upsertNode(
    viewNode({
      id: "A-SYS",
      kind: "arch_node",
      title: "System",
      text: "Modular monolith.",
      fields: { scope: "system" },
    }),
  );
  source.upsertNode(viewNode({ id: "X1", kind: "rule", title: "Plain language", text: "Use plain language." }));
  const edge: ViewEdge = {
    src: "R17",
    type: "implements",
    dst: "F-Orders",
    dstVersionPin: 1,
    validFromRev: 1,
    validToRev: null,
  };
  source.replaceEdges([edge]);
  source.setRevision(1);
  return source;
}

export async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "ef-views-"));
}

export function fakeGit(): (projectRoot: string, args: readonly string[]) => Promise<string> {
  return async () => ".git/info/exclude";
}
