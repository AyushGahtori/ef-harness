import { assertId, readStringArray } from "./canonical.js";
import { FeaturePlanError } from "./errors.js";
import type { FeaturePlanDatabase } from "./state-db.js";
import { RELATION_KEYS, type EdgeType, type RelationKey, type RelationSource, type StoredEdge } from "./types.js";

const EDGE_FOR_KEY: Record<RelationKey, EdgeType> = {
  implements: "implements",
  verifies: "verifies",
  depends_on: "depends_on",
  touches_entity: "touches_entity",
  belongs_to: "belongs_to",
  consumes_contract: "consumes_contract",
  consumes: "consumes_contract",
};

export interface NormalizeResult {
  readonly edges: readonly StoredEdge[];
  readonly nodeIds: readonly string[];
}

/**
 * Moves structural relations out of planner and oracle JSON fields into
 * canonical edge rows. A dangling node id aborts the transaction before commit.
 */
export class RelationsToEdgesNormalizer {
  constructor(private readonly db: FeaturePlanDatabase) {}

  commit(batch: readonly RelationSource[]): NormalizeResult {
    return this.db.transaction(() => {
      const known = new Set(this.db.activeIds());
      for (const source of batch) {
        assertId(source.id, source.id);
        known.add(source.id);
      }
      const edges = collectEdges(batch, known);
      for (const source of batch) {
        this.db.deleteOutgoing(source.id);
        this.db.upsertNode({
          id: source.id,
          kind: source.kind,
          title: source.title,
          text: source.text,
          featureId: source.featureId,
          fields: stripRelationFields(source.fields),
        });
      }
      for (const edge of edges) this.db.insertEdge(edge);
      const stray = [...this.db.relationsInFields(), ...this.db.extendedRelationsInFields()];
      if (stray.length > 0) {
        throw new FeaturePlanError(
          "relations_in_fields",
          `relations_in_fields found relation lists still stored on ${stray.join(", ")}`,
          { ids: stray },
        );
      }
      return { edges, nodeIds: batch.map((source) => source.id) };
    });
  }
}

export function stripRelationFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if ((RELATION_KEYS as readonly string[]).includes(key)) continue;
    next[key] = value;
  }
  return next;
}

export function collectEdges(batch: readonly RelationSource[], known: ReadonlySet<string>): StoredEdge[] {
  const edges: StoredEdge[] = [];
  const seen = new Set<string>();
  for (const source of batch) {
    if (!known.has(source.id)) {
      throw new FeaturePlanError("dangling_node", `Source ${source.id} does not exist`, { nodeId: source.id });
    }
    for (const key of RELATION_KEYS) {
      const targets = readStringArray(source.fields, key);
      const type = EDGE_FOR_KEY[key];
      for (const dst of targets) {
        assertId(dst, dst);
        if (!known.has(dst)) {
          throw new FeaturePlanError(
            "dangling_node",
            `${source.id}.${key} references ${dst} which does not exist`,
            { nodeId: dst, sourceId: source.id, relation: key },
          );
        }
        const signature = `${source.id}\u0000${type}\u0000${dst}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        edges.push({ src: source.id, type, dst });
      }
    }
  }
  return edges;
}
