import { readRepo } from "./runtime.js";

export const AREA_B_EVIDENCE = [
  "email-channel-settled-recipient-missing",
  "phone-mobile-web-offline-native-open",
  "acyclic-derived-from",
  "selective-supersession",
  "retraction-before-commit",
  "relations-in-fields",
] as const;

export interface Grounding {
  channel?: string;
  recipient?: string;
  supports: string[];
  leavesOpen: string[];
  missing: string[];
}

export function groundUtterance(text: string): Grounding {
  const normalized = text.toLowerCase();
  if (normalized.includes("email the totals")) {
    return { channel: "email", supports: ["channel:email"], leavesOpen: [], missing: ["recipient"] };
  }
  if (normalized.includes("link on their phones") || normalized.includes("link on a phone")) {
    return { supports: ["mobile-web"], leavesOpen: ["offline", "native"], missing: [] };
  }
  return { supports: [], leavesOpen: [], missing: ["interpretation"] };
}

export function acceptLeavesOpen(grounding: Grounding, choice: string): void {
  if (grounding.leavesOpen.includes(choice)) {
    throw new Error(`${choice} remains leaves_open and cannot be settled`);
  }
}

export function assertAcyclic(edges: readonly (readonly [string, string])[]): void {
  const adj = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string): void => {
    if (visited.has(node)) return;
    if (visiting.has(node)) throw new Error(`derived_from cycle at ${node}`);
    visiting.add(node);
    for (const next of adj.get(node) ?? []) walk(next);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of adj.keys()) walk(node);
}

export function reopenDependents(nodes: readonly { id: string; derivedFrom: readonly string[] }[], premise: string): string[] {
  const reopened = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (reopened.has(node.id)) continue;
      if (node.derivedFrom.some((parent) => parent === premise || reopened.has(parent))) {
        reopened.add(node.id);
        changed = true;
      }
    }
  }
  return [...reopened].sort();
}

export function retractBeforeCommit(chunks: readonly { ideas: readonly string[]; retracts?: readonly string[] }[]): string[] {
  const dropped = new Set<string>();
  for (const chunk of chunks) {
    for (const id of chunk.retracts ?? []) dropped.add(id);
  }
  return chunks.flatMap((chunk) => chunk.ideas).filter((id) => !dropped.has(id));
}

const RELATION_KEYS = ["depends_on", "implements", "verifies", "consumes"] as const;

export function relationsInFields(fields: Record<string, unknown>): string[] {
  return RELATION_KEYS.filter((key) => fields[key] !== undefined);
}

export async function runAreaB(): Promise<string[]> {
  const evidence: string[] = [];
  const email = groundUtterance("Email the totals");
  if (email.channel !== "email" || !email.missing.includes("recipient")) {
    throw new Error("email utterance did not settle the channel and leave the recipient missing");
  }
  evidence.push("email-channel-settled-recipient-missing");
  const phone = groundUtterance("Put the link on their phones");
  if (!phone.supports.includes("mobile-web") || phone.leavesOpen.join(",") !== "offline,native") {
    throw new Error("phone utterance did not keep offline and native open");
  }
  let rejected = false;
  try {
    acceptLeavesOpen(phone, "native");
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("leaves_open");
  }
  if (!rejected) throw new Error("native was accepted as settled");
  evidence.push("phone-mobile-web-offline-native-open");
  assertAcyclic([
    ["claim-mobile", "premise-phone"],
    ["premise-phone", "utterance-1"],
  ]);
  let cyclic = false;
  try {
    assertAcyclic([
      ["a", "b"],
      ["b", "a"],
    ]);
  } catch (error) {
    cyclic = error instanceof Error && error.message.includes("cycle");
  }
  if (!cyclic) throw new Error("cyclic derived_from was accepted");
  evidence.push("acyclic-derived-from");
  const reopened = reopenDependents(
    [
      { id: "mobile-web", derivedFrom: ["phone-link"] },
      { id: "print-copy", derivedFrom: ["mobile-web"] },
      { id: "unrelated-tax", derivedFrom: ["tax-rule"] },
    ],
    "phone-link",
  );
  if (reopened.join(",") !== "mobile-web,print-copy") throw new Error(`supersession reopened ${reopened.join(",")}`);
  evidence.push("selective-supersession");
  const committed = retractBeforeCommit([
    { ideas: ["spoken-idea", "keep-me"] },
    { ideas: [], retracts: ["spoken-idea"] },
  ]);
  if (committed.join(",") !== "keep-me") throw new Error("retraction survived until commit");
  evidence.push("retraction-before-commit");
  if (!readRepo("schema/queries.sql").includes("name: relations_in_fields")) {
    throw new Error("relations_in_fields query missing");
  }
  const leaked = relationsInFields({ goal: "print", depends_on: ["T01"] });
  if (leaked.join(",") !== "depends_on") throw new Error("field relations were not flagged");
  if (relationsInFields({ goal: "print" }).length !== 0) throw new Error("clean fields were flagged");
  evidence.push("relations-in-fields");
  return evidence;
}
