import type { ModelReferenceResolution, PolicyModel, RosterModelRecord } from "./types.js";

export interface RosterMergeReport {
  added: string[];
  updated: string[];
  preserved: string[];
  revokedByOmission: string[];
}

export class VersionedModelRosterPort {
  private readonly records = new Map<string, RosterModelRecord>();
  private readonly policyNotes = new Map<
    string,
    Pick<PolicyModel, "deprecatedAfter" | "replacementModelId" | "revoked">
  >();

  constructor(initial: readonly RosterModelRecord[] = []) {
    for (const record of initial) {
      this.records.set(record.modelId, cloneRecord(record));
    }
  }

  list(): RosterModelRecord[] {
    return [...this.records.values()].map((record) => cloneRecord(record));
  }

  selectable(): RosterModelRecord[] {
    return this.list().filter((record) => !record.revoked);
  }

  get(modelId: string): RosterModelRecord | null {
    const record = this.records.get(modelId);
    return record ? cloneRecord(record) : null;
  }

  upsert(record: RosterModelRecord): void {
    this.records.set(record.modelId, cloneRecord(record));
  }

  applyPolicyModels(models: readonly PolicyModel[], publishedAt: string): RosterMergeReport {
    const report: RosterMergeReport = {
      added: [],
      updated: [],
      preserved: [],
      revokedByOmission: [],
    };
    const incoming = new Set(models.map((model) => model.modelId));
    for (const model of models) {
      const existing = this.records.get(model.modelId);
      if (existing && isPreserved(existing)) {
        this.policyNotes.set(model.modelId, {
          deprecatedAfter: model.deprecatedAfter,
          replacementModelId: model.replacementModelId,
          revoked: model.revoked,
        });
        report.preserved.push(model.modelId);
        continue;
      }
      const next = fromPolicy(model);
      if (existing) report.updated.push(model.modelId);
      else report.added.push(model.modelId);
      this.records.set(model.modelId, next);
      this.policyNotes.delete(model.modelId);
    }
    for (const [modelId, existing] of this.records) {
      if (existing.origin !== "policy" || isPreserved(existing) || incoming.has(modelId)) continue;
      this.records.set(modelId, {
        ...existing,
        revoked: true,
        deprecatedAfter: existing.deprecatedAfter ?? publishedAt,
      });
      report.revokedByOmission.push(modelId);
    }
    return report;
  }

  resolveReference(modelId: string): ModelReferenceResolution {
    const record = this.records.get(modelId) ?? null;
    if (!record) {
      return {
        found: false,
        record: null,
        selectable: false,
        replacementModelId: null,
        recommendation: `No roster entry for ${modelId}`,
      };
    }
    const note = this.policyNotes.get(modelId);
    const revoked = record.revoked || note?.revoked === true;
    const replacementModelId = note?.replacementModelId ?? record.replacementModelId;
    const deprecatedAfter = note?.deprecatedAfter ?? record.deprecatedAfter;
    const deprecated = deprecatedAfter !== null || revoked;
    let recommendation: string | null = null;
    if (deprecated) {
      recommendation = replacementModelId
        ? `${modelId} is ${revoked ? "revoked" : "deprecated"}; use ${replacementModelId}`
        : `${modelId} is ${revoked ? "revoked" : "deprecated"}`;
    }
    return {
      found: true,
      record: cloneRecord(record),
      selectable: !revoked,
      replacementModelId,
      recommendation,
    };
  }
}

function isPreserved(record: RosterModelRecord): boolean {
  return (
    record.pinnedByUser ||
    record.origin === "user" ||
    record.origin === "ollama" ||
    record.origin === "lmstudio"
  );
}

function fromPolicy(model: PolicyModel): RosterModelRecord {
  return {
    modelId: model.modelId,
    family: model.family,
    provider: model.provider,
    tier: model.tier,
    contextWindow: model.contextWindow,
    supportsTools: model.supportsTools,
    supportsStructuredJson: model.supportsStructuredJson,
    supportsVision: model.supportsVision,
    inputMicroUsdPer1M: model.inputMicroUsdPer1M,
    outputMicroUsdPer1M: model.outputMicroUsdPer1M,
    cachedInputMicroUsdPer1M: model.cachedInputMicroUsdPer1M,
    defaultPassPriors: { ...model.defaultPassPriors },
    deprecatedAfter: model.deprecatedAfter,
    replacementModelId: model.replacementModelId,
    revoked: model.revoked,
    origin: "policy",
    pinnedByUser: false,
  };
}

function cloneRecord(record: RosterModelRecord): RosterModelRecord {
  return { ...record, defaultPassPriors: { ...record.defaultPassPriors } };
}
