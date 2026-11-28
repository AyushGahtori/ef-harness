import { IntentGraph } from "../../src/canvas/intents/graph.js";
import type { SeedEdge, SeedNode, SeedTask } from "../../src/canvas/intents/types.js";

export class TrackingModel {
  calls = 0;

  complete(prompt: string): string {
    this.calls += 1;
    return prompt;
  }
}

export class TrackingNetwork {
  calls = 0;

  request(path: string): void {
    void path;
    this.calls += 1;
  }
}

export function seedImpactGraph(): IntentGraph {
  const graph = new IntentGraph();
  const nodes: SeedNode[] = [
    {
      id: "entity:Order",
      kind: "entity",
      title: "Order",
      text: "Order aggregate",
      lifecycle: "plan",
    },
    {
      id: "C-Checkout",
      kind: "contract",
      title: "Checkout API",
      text: "Checkout contract",
      lifecycle: "building",
    },
    {
      id: "S-OrderForm",
      kind: "screen",
      title: "Order form",
      text: "Order form screen",
      lifecycle: "building",
      fields: { role: "screen" },
    },
    {
      id: "D-17",
      kind: "decision",
      title: "Cutoff Rule R17",
      text: "Cutoff at",
      value: "11:00 AM",
      version: 3,
      basis: "explicit",
      lifecycle: "building",
      age: "older",
      provenanceQuote: "spec §4.2",
      codeStatus: "partial",
    },
    {
      id: "D-1",
      kind: "decision",
      title: "Decision D-1",
      text: "Decision one",
      value: "alpha",
      basis: "explicit",
      lifecycle: "plan",
    },
    {
      id: "D-2",
      kind: "decision",
      title: "Decision D-2",
      text: "Decision two",
      value: "beta",
      basis: "explicit",
      lifecycle: "plan",
    },
    {
      id: "R-Derived",
      kind: "requirement",
      title: "Derived cutoff copy",
      text: "Ship before 11:15",
      value: "11:15",
      status: "proposed",
      basis: "derived",
      newlyExtracted: true,
      lifecycle: "discovery",
    },
    {
      id: "D-Dictated",
      kind: "decision",
      title: "Cutoff dictated",
      text: "Cutoff at 11:15",
      value: "11:15",
      freshlyDictated: true,
      amberLowConfidence: true,
      dictationBadge: true,
      basis: "proposed",
      lifecycle: "discovery",
    },
    {
      id: "F-Print",
      kind: "feature",
      title: "F-Print",
      text: "Print receipts",
      status: "DONE",
      basis: "explicit",
      lifecycle: "done",
      built: true,
      landed: true,
      fields: {
        sharedHelpers: ["formatReceipt"],
        dormantTables: ["print_jobs"],
        exclusiveFiles: ["src/print.ts"],
      },
    },
    {
      id: "R-Spec",
      kind: "requirement",
      title: "Spec tweak",
      text: "Colour label",
      value: "Colour",
      lifecycle: "spec",
      built: false,
      landed: false,
    },
    {
      id: "R-Typo",
      kind: "requirement",
      title: "Tiny label",
      text: "Cutof rule",
      value: "Cutof rule",
      lifecycle: "discovery",
    },
    {
      id: "F-Parent",
      kind: "feature",
      title: "Orders",
      text: "Orders feature",
      lifecycle: "spec",
    },
  ];
  const edges: SeedEdge[] = [
    { src: "C-Checkout", type: "implements", dst: "entity:Order" },
    { src: "S-OrderForm", type: "implements", dst: "C-Checkout" },
    { src: "D-17", type: "depends_on", dst: "entity:Order" },
    { src: "T-9", type: "depends_on", dst: "D-1" },
    { src: "T-9", type: "depends_on", dst: "D-2" },
    { src: "R-Derived", type: "derived_from", dst: "D-Dictated" },
    { src: "C-Checkout", type: "depends_on", dst: "D-17" },
    { src: "S-OrderForm", type: "depends_on", dst: "D-17" },
  ];
  const tasks: SeedTask[] = [
    { id: "T-Active", state: "WORKING", title: "Order form" },
    { id: "T-9", state: "WORKING", title: "Shared gate" },
    { id: "T-Merged", state: "DONE", title: "Checkout polish" },
    { id: "T-Untouched", state: "WORKING", title: "Docs" },
  ];
  for (const node of nodes) graph.seedNode(node);
  for (const edge of edges) graph.seedEdge(edge);
  for (const task of tasks) graph.seedTask(task);
  graph.seedEdge({ src: "T-Active", type: "verifies", dst: "S-OrderForm" });
  graph.seedEdge({ src: "T-Merged", type: "verifies", dst: "C-Checkout" });
  graph.executeCanonical("entity:Order");
  graph.executeCanonical("D-1");
  return graph;
}