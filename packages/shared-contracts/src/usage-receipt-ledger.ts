export type UsageCurrency = "micro_usd" | "allowance_ppm" | "local";
export type UsagePhase = "coding" | "paperwork";
export type PricingSource = "estimated" | "provider_reported";
export type WindowKind = "5h" | "weekly" | "monthly";

export interface UsageReceiptInput {
  readonly timestamp: number;
  readonly project: string;
  readonly feature: string;
  readonly taskId: string;
  readonly role: string;
  readonly connection: string;
  readonly model: string;
  readonly phase: UsagePhase;
  readonly currency: UsageCurrency;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd: number;
  readonly windowDeltaPpm: number;
  readonly premiumRequests: number;
  readonly tokPerSec: number;
  readonly gpuMs: number;
  readonly pricingSource: PricingSource;
  readonly priceTableVersion: string;
  readonly provider: string;
  readonly kModel: string;
  readonly windowKind: WindowKind;
  readonly allowanceUsedPpm: number;
  readonly resetAt: number;
  readonly rawSecret?: string;
  readonly vaultRef?: string;
}

export interface UsageReceiptRow {
  readonly timestamp: number;
  readonly project: string;
  readonly feature: string;
  readonly taskId: string;
  readonly role: string;
  readonly connection: string;
  readonly model: string;
  readonly phase: UsagePhase;
  readonly currency: UsageCurrency;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd: number;
  readonly windowDeltaPpm: number;
  readonly premiumRequests: number;
  readonly tokPerSec: number;
  readonly gpuMs: number;
  readonly pricingSource: PricingSource;
  readonly priceTableVersion: string;
  readonly provider: string;
  readonly kModel: string;
  readonly windowKind: WindowKind;
  readonly allowanceUsedPpm: number;
  readonly resetAt: number;
}

export interface UsageApiAggregate {
  readonly axis: "project" | "feature" | "phase" | "model";
  readonly key: string;
  readonly pricingSource: PricingSource;
  readonly priceTableVersion: string;
  readonly provider: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly microUsd: number;
}

export interface UsageWindowAggregate {
  readonly windowKind: WindowKind;
  readonly model: string;
  readonly allowanceUsedPpm: number;
  readonly resetAt: number;
  readonly kModel: string;
  readonly premiumRequests: number;
}

export interface UsageLocalAggregate {
  readonly tokens: number;
  readonly averageTokPerSec: number;
  readonly gpuMs: number;
  readonly cloudMicroUsd: 0;
}

export interface UsageReceiptQuery {
  readonly currency: UsageCurrency;
  readonly search: string;
  readonly limit: number;
  readonly offset: number;
}

export const USAGE_RECEIPT_SCHEMA = "usage-receipt@1" as const;

interface StoredReceipt {
  readonly id: number;
  readonly row: UsageReceiptRow;
}

interface WindowBucket {
  windowKind: WindowKind;
  model: string;
  allowanceUsedPpm: number;
  resetAt: number;
  kModel: string;
  premiumRequests: number;
}

export function publicUsageReceipt(receipt: UsageReceiptInput): UsageReceiptRow {
  return {
    timestamp: receipt.timestamp,
    project: receipt.project,
    feature: receipt.feature,
    taskId: receipt.taskId,
    role: receipt.role,
    connection: receipt.connection,
    model: receipt.model,
    phase: receipt.phase,
    currency: receipt.currency,
    inputTokens: receipt.inputTokens,
    cachedTokens: receipt.cachedTokens,
    outputTokens: receipt.outputTokens,
    reasoningTokens: receipt.reasoningTokens,
    costMicroUsd: receipt.costMicroUsd,
    windowDeltaPpm: receipt.windowDeltaPpm,
    premiumRequests: receipt.premiumRequests,
    tokPerSec: receipt.tokPerSec,
    gpuMs: receipt.gpuMs,
    pricingSource: receipt.pricingSource,
    priceTableVersion: receipt.priceTableVersion,
    provider: receipt.provider,
    kModel: receipt.kModel,
    windowKind: receipt.windowKind,
    allowanceUsedPpm: receipt.allowanceUsedPpm,
    resetAt: receipt.resetAt,
  };
}

function matchesSearch(row: UsageReceiptRow, search: string): boolean {
  if (search === "") return true;
  const needle = search.toLowerCase();
  return (
    row.project.toLowerCase().includes(needle) ||
    row.taskId.toLowerCase().includes(needle) ||
    row.model.toLowerCase().includes(needle) ||
    row.connection.toLowerCase().includes(needle) ||
    row.role.toLowerCase().includes(needle) ||
    row.feature.toLowerCase().includes(needle)
  );
}

/**
 * In-memory fold of usage receipts. Secrets stay out of the stored rows.
 * Daemon persistence writes these public rows into telemetry.db.
 */
export class UsageReceiptLedger {
  private readonly rows: StoredReceipt[] = [];
  private readonly api = new Map<string, UsageApiAggregate>();
  private readonly windows = new Map<string, WindowBucket>();
  private localTokens = 0;
  private localTokSum = 0;
  private localSamples = 0;
  private localGpuMs = 0;
  private persisted = "";
  private nextId = 1;

  insert(receipts: readonly UsageReceiptInput[]): void {
    const chunks: string[] = [];
    for (const receipt of receipts) {
      const row = publicUsageReceipt(receipt);
      const id = this.nextId;
      this.nextId += 1;
      this.rows.push({ id, row });
      chunks.push(JSON.stringify(row));
      if (row.currency === "micro_usd") this.addApi(row);
      else if (row.currency === "allowance_ppm") this.addWindow(row);
      else {
        this.localTokens += row.inputTokens + row.outputTokens;
        this.localTokSum += row.tokPerSec;
        this.localSamples += 1;
        this.localGpuMs += row.gpuMs;
      }
    }
    if (chunks.length > 0) this.persisted += chunks.join("\n");
  }

  count(query: Pick<UsageReceiptQuery, "currency" | "search">): number {
    let total = 0;
    for (const stored of this.rows) {
      if (stored.row.currency !== query.currency) continue;
      if (!matchesSearch(stored.row, query.search)) continue;
      total += 1;
    }
    return total;
  }

  page(query: UsageReceiptQuery): UsageReceiptRow[] {
    const matched: StoredReceipt[] = [];
    for (const stored of this.rows) {
      if (stored.row.currency !== query.currency) continue;
      if (!matchesSearch(stored.row, query.search)) continue;
      matched.push(stored);
    }
    matched.sort((left, right) => right.row.timestamp - left.row.timestamp || right.id - left.id);
    const start = query.offset;
    const end = query.offset + query.limit;
    const slice: UsageReceiptRow[] = [];
    for (let index = start; index < end && index < matched.length; index += 1) {
      const row = matched[index];
      if (row) slice.push(row.row);
    }
    return slice;
  }

  apiAggregates(): UsageApiAggregate[] {
    return [...this.api.values()];
  }

  windowAggregates(): UsageWindowAggregate[] {
    return [...this.windows.values()];
  }

  localAggregate(): UsageLocalAggregate {
    return {
      tokens: this.localTokens,
      averageTokPerSec: this.localSamples === 0 ? 0 : Math.round(this.localTokSum / this.localSamples),
      gpuMs: this.localGpuMs,
      cloudMicroUsd: 0,
    };
  }

  persistedDataIncludes(needle: string): boolean {
    return this.persisted.includes(needle);
  }

  close(): void {
    return;
  }

  private addApi(row: UsageReceiptRow): void {
    const axes = [
      ["project", row.project],
      ["feature", row.feature],
      ["phase", row.phase],
      ["model", row.model],
    ] as const;
    for (const [axis, key] of axes) {
      const id = `${axis}\u0000${key}\u0000${row.pricingSource}\u0000${row.priceTableVersion}\u0000${row.provider}`;
      const existing = this.api.get(id);
      if (!existing) {
        this.api.set(id, {
          axis,
          key,
          pricingSource: row.pricingSource,
          priceTableVersion: row.priceTableVersion,
          provider: row.provider,
          inputTokens: row.inputTokens,
          cachedTokens: row.cachedTokens,
          outputTokens: row.outputTokens,
          reasoningTokens: row.reasoningTokens,
          microUsd: row.costMicroUsd,
        });
        continue;
      }
      this.api.set(id, {
        ...existing,
        inputTokens: existing.inputTokens + row.inputTokens,
        cachedTokens: existing.cachedTokens + row.cachedTokens,
        outputTokens: existing.outputTokens + row.outputTokens,
        reasoningTokens: existing.reasoningTokens + row.reasoningTokens,
        microUsd: existing.microUsd + row.costMicroUsd,
      });
    }
  }

  private addWindow(row: UsageReceiptRow): void {
    const id = `${row.windowKind}\u0000${row.model}`;
    const existing = this.windows.get(id);
    if (!existing) {
      this.windows.set(id, {
        windowKind: row.windowKind,
        model: row.model,
        allowanceUsedPpm: row.allowanceUsedPpm,
        resetAt: row.resetAt,
        kModel: row.kModel,
        premiumRequests: row.premiumRequests,
      });
      return;
    }
    existing.allowanceUsedPpm = Math.max(existing.allowanceUsedPpm, row.allowanceUsedPpm);
    existing.resetAt = Math.max(existing.resetAt, row.resetAt);
    if (row.kModel > existing.kModel) existing.kModel = row.kModel;
    existing.premiumRequests += row.premiumRequests;
  }
}
