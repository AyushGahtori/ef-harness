import { createHash } from "node:crypto";

import type { BehaviorSnapshot, DiffOp, SchemaBundle, SemanticAlternative, SemanticReview } from "./types.js";

export class CcrSemanticCompatibilityReviewer {
  review(input: {
    readonly before: SchemaBundle;
    readonly after: SchemaBundle;
    readonly behaviorBefore?: BehaviorSnapshot;
    readonly behaviorAfter?: BehaviorSnapshot;
    readonly structuralUnchanged: boolean;
  }): SemanticReview {
    const before = input.behaviorBefore ?? {};
    const after = input.behaviorAfter ?? {};
    const reasons: string[] = [];
    const alternatives: SemanticAlternative[] = [];
    const consumers = new Set<string>(after.consumers ?? before.consumers ?? []);
    const schemaSame = input.structuralUnchanged || bundleText(input.before) === bundleText(input.after);

    const sortBefore = before.defaultSort?.trim();
    const sortAfter = after.defaultSort?.trim();
    if (sortBefore && sortAfter && sortBefore !== sortAfter) {
      reasons.push(`default sort changed from ${sortBefore} to ${sortAfter}`);
      consumers.add("M04");
      consumers.add("UI tests");
      alternatives.push({
        summary: `Prefer additive optional sort query defaulting to ${sortBefore}`,
        additive: true,
      });
    }

    const zoneBefore = before.timezone?.trim();
    const zoneAfter = after.timezone?.trim();
    if (zoneBefore && zoneAfter && zoneBefore !== zoneAfter) {
      reasons.push(`timezone interpretation changed from ${zoneBefore} to ${zoneAfter}`);
      alternatives.push({
        summary: `Prefer additive field that keeps ${zoneBefore} and adds an explicit UTC timestamp`,
        additive: true,
      });
    }

    const pageBefore = before.paginationDefault?.trim();
    const pageAfter = after.paginationDefault?.trim();
    if (pageBefore && pageAfter && pageBefore !== pageAfter) {
      reasons.push(`pagination default changed from ${pageBefore} to ${pageAfter}`);
      alternatives.push({
        summary: `Prefer additive optional page parameter defaulting to ${pageBefore}`,
        additive: true,
      });
    }

    for (const field of ["authSemantics", "tenantSemantics", "errorEnvelope"] as const) {
      const left = before[field]?.trim();
      const right = after[field]?.trim();
      if (left && right && left !== right) {
        reasons.push(`${field} changed from ${left} to ${right}`);
      }
    }

    if (!schemaSame && reasons.length === 0) {
      return { breaking: false, reasons: [], consumers: [], alternatives: [], unchangedSchema: false };
    }
    return {
      breaking: reasons.length > 0,
      reasons,
      consumers: [...consumers].sort(),
      alternatives,
      unchangedSchema: schemaSame,
    };
  }
}

export function bundleText(bundle: SchemaBundle): string {
  return [bundle.sql ?? "", bundle.openapi ?? "", bundle.jsonSchema ?? "", bundle.typescript ?? ""].join("\n--\n");
}

export function fingerprintFor(target: string, ops: readonly DiffOp[], semantic: SemanticReview): string {
  const structural = ops.map((op) => op.signature).sort().join("|");
  const hidden = semantic.breaking ? semantic.reasons.join("|") : "";
  return createHash("sha256").update(`${target}\n${structural}\n${hidden}`).digest("hex").slice(0, 16);
}

export function semanticSummary(review: SemanticReview): string | null {
  if (!review.breaking) return null;
  return review.reasons.join("; ");
}
