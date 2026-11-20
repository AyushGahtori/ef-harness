import { cloneFields, sameJson } from "./hash.js";
import type { FieldMap, FieldValue } from "./types.js";

export interface Presence {
  readonly present: boolean;
  readonly value: FieldValue | null;
}

export type FieldDecision =
  | { readonly kind: "unchanged"; readonly key: string; readonly value: FieldValue }
  | { readonly kind: "take_remote"; readonly key: string; readonly value: FieldValue }
  | { readonly kind: "take_local"; readonly key: string; readonly value: FieldValue }
  | { readonly kind: "delete_local"; readonly key: string }
  | { readonly kind: "delete_remote"; readonly key: string }
  | {
      readonly kind: "conflict";
      readonly key: string;
      readonly base: Presence;
      readonly local: Presence;
      readonly remote: Presence;
    };

export type TextDecision = "unchanged" | "local" | "remote" | "conflict";

export interface ThreeWayPlan {
  readonly fields: readonly FieldDecision[];
  readonly prose: TextDecision;
  readonly title: TextDecision;
  readonly hasConflict: boolean;
  readonly hasLocalChange: boolean;
}

export interface ThreeWayInput {
  readonly baseFields: FieldMap;
  readonly localFields: FieldMap;
  readonly remoteFields: FieldMap;
  readonly baseProse: string;
  readonly localProse: string;
  readonly remoteProse: string;
  readonly baseTitle: string;
  readonly localTitle: string;
  readonly remoteTitle: string;
}

/**
 * Deterministic three-way field merge.
 * Base is the exported snapshot, local is the edited Markdown, remote is the current database head.
 * Structured fields never call a model.
 */
export class ThreeWayNodeMerger {
  plan(input: ThreeWayInput): ThreeWayPlan {
    const keys = new Set<string>([
      ...Object.keys(input.baseFields),
      ...Object.keys(input.localFields),
      ...Object.keys(input.remoteFields),
    ]);
    const fields: FieldDecision[] = [];
    for (const key of [...keys].sort()) {
      fields.push(decideField(key, input.baseFields, input.localFields, input.remoteFields));
    }
    const prose = decideText(input.baseProse, input.localProse, input.remoteProse);
    const title = decideText(input.baseTitle, input.localTitle, input.remoteTitle);
    const hasConflict = fields.some((decision) => decision.kind === "conflict") || prose === "conflict" || title === "conflict";
    const hasLocalChange =
      fields.some((decision) => decision.kind === "take_local" || decision.kind === "delete_local") ||
      prose === "local" ||
      title === "local";
    return { fields, prose, title, hasConflict, hasLocalChange };
  }

  mergedFields(plan: ThreeWayPlan, remoteFields: FieldMap): FieldMap | null {
    if (plan.fields.some((decision) => decision.kind === "conflict")) return null;
    const merged = cloneFields(remoteFields);
    for (const key of Object.keys(merged)) delete merged[key];
    for (const decision of plan.fields) {
      if (decision.kind === "delete_local" || decision.kind === "delete_remote" || decision.kind === "conflict") continue;
      merged[decision.key] = decision.value;
    }
    return merged;
  }
}

export function presenceOf(map: FieldMap, key: string): Presence {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return { present: false, value: null };
  const value = map[key];
  return { present: true, value: value === undefined ? null : value };
}

function decideField(key: string, base: FieldMap, local: FieldMap, remote: FieldMap): FieldDecision {
  const basePresence = presenceOf(base, key);
  const localPresence = presenceOf(local, key);
  const remotePresence = presenceOf(remote, key);
  const localChanged = !samePresence(basePresence, localPresence);
  const remoteChanged = !samePresence(basePresence, remotePresence);
  if (!localChanged && !remoteChanged) {
    return { kind: "unchanged", key, value: basePresence.value as FieldValue };
  }
  if (localChanged && remoteChanged && !samePresence(localPresence, remotePresence)) {
    return { kind: "conflict", key, base: basePresence, local: localPresence, remote: remotePresence };
  }
  if (localChanged) {
    if (!localPresence.present) return { kind: "delete_local", key };
    return { kind: "take_local", key, value: localPresence.value ?? null };
  }
  if (!remotePresence.present) return { kind: "delete_remote", key };
  return { kind: "take_remote", key, value: remotePresence.value ?? null };
}

function decideText(base: string, local: string, remote: string): TextDecision {
  const localChanged = local !== base;
  const remoteChanged = remote !== base;
  if (!localChanged && !remoteChanged) return "unchanged";
  if (localChanged && remoteChanged && local !== remote) return "conflict";
  if (localChanged) return "local";
  return "remote";
}

function samePresence(left: Presence, right: Presence): boolean {
  if (left.present !== right.present) return false;
  if (!left.present) return true;
  return sameJson(left.value, right.value);
}
