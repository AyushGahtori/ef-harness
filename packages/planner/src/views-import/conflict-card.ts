import type { ConflictAction, FieldValue, ImportConflictCard } from "./types.js";
import { canonicalJson } from "./hash.js";
import type { FieldDecision, Presence } from "./three-way.js";

const ACTIONS: readonly ConflictAction[] = ["keep_mine", "keep_current", "edit_merged"];

/** Builds the Base / Your Edit / Current DB card. Neither side is chosen here. */
export class ImportConflictCardBuilder {
  fieldCard(filePath: string, nodeId: string, decision: Extract<FieldDecision, { kind: "conflict" }>): ImportConflictCard {
    return this.card(filePath, nodeId, "field", decision.key, decision.base, decision.local, decision.remote);
  }

  textCard(
    filePath: string,
    nodeId: string,
    kind: "prose" | "title",
    base: string,
    local: string,
    remote: string,
  ): ImportConflictCard {
    return this.card(
      filePath,
      nodeId,
      kind,
      kind,
      { present: true, value: base },
      { present: true, value: local },
      { present: true, value: remote },
    );
  }

  private card(
    filePath: string,
    nodeId: string,
    kind: ImportConflictCard["kind"],
    field: string,
    base: Presence,
    local: Presence,
    remote: Presence,
  ): ImportConflictCard {
    return {
      cardId: `conflict:${filePath}:${nodeId}:${field}`,
      kind,
      filePath,
      nodeId,
      field,
      base: base.value,
      basePresent: base.present,
      yourEdit: local.value,
      yourEditPresent: local.present,
      currentDb: remote.value,
      currentDbPresent: remote.present,
      actions: ACTIONS,
      summary: `Base: ${display(base)}, Your Markdown Edit: ${display(local)}, Current Chat Value: ${display(remote)}`,
    };
  }
}

function display(presence: Presence): string {
  if (!presence.present) return "(absent)";
  return displayValue(presence.value);
}

export function displayValue(value: FieldValue | null): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return canonicalJson(value);
}
