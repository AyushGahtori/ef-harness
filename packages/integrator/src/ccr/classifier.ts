import { collectedFormats, diffJsonSchema, diffOpenApi, diffTypeScript } from "./schema-diff.js";
import { bundleText } from "./semantic.js";
import { diffSql } from "./sql-diff.js";
import type { ClaimedClass, DiffClass, DiffOp, SchemaBundle, SchemaDiffResult } from "./types.js";

export interface ChangeClassifierFloor {
  readonly changeClass: "cosmetic" | "clarifying" | "compatible" | "breaking";
  readonly floorApplied: boolean;
  readonly reasons: readonly string[];
}

/**
 * Local port of Task 087 `ChangeClassifier`.
 * Breaking structural diffs cannot be downgraded by an agent label.
 * Text that changed but produced no parsed op is also breaking.
 */
export class LocalChangeClassifier {
  classify(input: {
    readonly beforeText: string;
    readonly afterText: string;
    readonly requestedClass?: string;
    readonly structural: DiffClass;
  }): ChangeClassifierFloor {
    const requested = input.requestedClass ?? "";
    const downgradeRequested =
      requested === "additive" || requested === "cosmetic" || requested === "clarifying" || requested === "compatible";
    if (input.beforeText.trim() === input.afterText.trim()) {
      return { changeClass: "cosmetic", floorApplied: false, reasons: [] };
    }
    if (input.structural === "BREAKING") {
      return {
        changeClass: "breaking",
        floorApplied: downgradeRequested,
        reasons: downgradeRequested ? ["classification_floor"] : [],
      };
    }
    if (input.structural === "ADDITIVE") {
      return { changeClass: "compatible", floorApplied: false, reasons: ["additive_structural_diff"] };
    }
    return {
      changeClass: "breaking",
      floorApplied: true,
      reasons: ["unclassified_structural_change"],
    };
  }
}

export class DeterministicSchemaDiffClassifier {
  constructor(private readonly changeClassifier: LocalChangeClassifier = new LocalChangeClassifier()) {}

  classify(input: {
    readonly before: SchemaBundle;
    readonly after: SchemaBundle;
    readonly claimedClass?: ClaimedClass;
    readonly claimedAdditive?: boolean;
  }): SchemaDiffResult {
    const beforeSql = input.before.sql ?? "";
    const afterSql = input.after.sql ?? "";
    const beforeApi = input.before.openapi ?? "";
    const afterApi = input.after.openapi ?? "";
    const beforeJson = input.before.jsonSchema ?? "";
    const afterJson = input.after.jsonSchema ?? "";
    const beforeTs = input.before.typescript ?? "";
    const afterTs = input.after.typescript ?? "";
    const ops: DiffOp[] = [
      ...diffSql(beforeSql, afterSql),
      ...diffOpenApi(beforeApi, afterApi),
      ...diffJsonSchema(beforeJson, afterJson),
      ...diffTypeScript(beforeTs, afterTs),
    ];
    let classification: DiffClass = ops.some((op) => op.breaking) ? "BREAKING" : ops.length > 0 ? "ADDITIVE" : "UNCHANGED";
    const claimed = input.claimedClass ?? (input.claimedAdditive === true ? "additive" : undefined);
    const floor = this.changeClassifier.classify({
      beforeText: bundleText(input.before),
      afterText: bundleText(input.after),
      ...(claimed !== undefined ? { requestedClass: claimed } : {}),
      structural: classification,
    });
    const reasons = ops.filter((op) => op.breaking).map((op) => op.detail);
    if (floor.changeClass === "breaking" && classification !== "BREAKING") {
      classification = "BREAKING";
      reasons.push(...floor.reasons);
      ops.push({
        signature: "unparsed|source=ChangeClassifier",
        kind: "unparsed",
        breaking: true,
        detail: floor.reasons.join("; ") || "unclassified structural change",
        payload: { source: "ChangeClassifier" },
      });
    } else if (floor.floorApplied) {
      reasons.push(...floor.reasons);
    }
    const claimedAdditive = input.claimedAdditive === true || input.claimedClass === "additive";
    const overridden =
      (claimedAdditive && classification === "BREAKING") ||
      (input.claimedClass === "breaking" && classification === "ADDITIVE");
    return {
      classification,
      overridden,
      reasons,
      ops,
      formats: collectedFormats({
        sql: beforeSql.trim().length > 0 || afterSql.trim().length > 0,
        openapi: beforeApi.trim().length > 0 || afterApi.trim().length > 0,
        jsonSchema: beforeJson.trim().length > 0 || afterJson.trim().length > 0,
        typescript: beforeTs.trim().length > 0 || afterTs.trim().length > 0,
      }),
    };
  }
}
