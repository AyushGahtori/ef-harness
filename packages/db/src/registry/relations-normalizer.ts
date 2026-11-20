import { InvalidRelationError } from "./errors.js";

/** Planner field → canonical `edges.type`. `consumes` is stored as `consumes_contract`. */
export const RELATION_FIELD_TO_EDGE_TYPE = {
  depends_on: "depends_on",
  implements: "implements",
  verifies: "verifies",
  consumes: "consumes_contract",
} as const;

export type RelationField = keyof typeof RELATION_FIELD_TO_EDGE_TYPE;
export type RelationEdgeType = (typeof RELATION_FIELD_TO_EDGE_TYPE)[RelationField];

export interface NormalizedEdge {
  field: RelationField;
  type: RelationEdgeType;
  dst: string;
}

export interface NormalizedRelations {
  fields: Record<string, unknown>;
  edges: NormalizedEdge[];
}

const RELATION_FIELDS = Object.keys(RELATION_FIELD_TO_EDGE_TYPE) as RelationField[];

/**
 * Moves planner relation lists out of `fields` and into canonical edge descriptors.
 * The input object is not mutated. Empty lists are removed so `relations_in_fields` stays empty.
 */
export class RelationsNormalizer {
  normalize(fields: Readonly<Record<string, unknown>>): NormalizedRelations {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new InvalidRelationError("fields", "fields must be an object");
    }
    const edges: NormalizedEdge[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!isRelationField(key)) {
        next[key] = value;
        continue;
      }
      for (const dst of relationTargets(key, value)) {
        edges.push({ field: key, type: RELATION_FIELD_TO_EDGE_TYPE[key], dst });
      }
    }
    return { fields: next, edges };
  }
}

export function normalizeRelations(fields: Readonly<Record<string, unknown>>): NormalizedRelations {
  return new RelationsNormalizer().normalize(fields);
}

function isRelationField(key: string): key is RelationField {
  return RELATION_FIELDS.includes(key as RelationField);
}

function relationTargets(field: RelationField, value: unknown): string[] {
  if (typeof value === "string") return [requireId(field, value)];
  if (!Array.isArray(value)) throw new InvalidRelationError(field, "expected a string or array");
  return value.map((entry, index) => {
    if (typeof entry === "string") return requireId(field, entry);
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const id = record["id"] ?? record["dst"] ?? record["node"];
      if (typeof id !== "string") {
        throw new InvalidRelationError(field, `entry ${String(index)} has no node id`);
      }
      return requireId(field, id);
    }
    throw new InvalidRelationError(field, `entry ${String(index)} is not a node id`);
  });
}

function requireId(field: RelationField, value: string): string {
  const id = value.trim();
  if (!id || /\s/.test(id)) throw new InvalidRelationError(field, JSON.stringify(value));
  return id;
}
