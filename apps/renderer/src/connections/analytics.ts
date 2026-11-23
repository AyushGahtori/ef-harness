import { UsageReceiptsCsvExporter, type CsvExport, type PublicReceipt } from "./csv.js";
import { formatCountdown, percentFromPpm } from "./format.js";
import type { ApiAggregate, ReceiptPageRow, TelemetryReceiptStore, UsageCurrency, WindowKind } from "./receipts.js";

export type UsageTab = "api" | "subscription" | "local";

export const REPORTED_BADGE = "Provider-reported (OpenRouter)";

export function estimatedBadge(version: string): string {
  return `Estimated from published rates (table v${version})`;
}

export interface MoneyBucket {
  readonly badge: string;
  readonly microUsd: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

export interface PhaseHonesty {
  readonly codingLabel: "Coding >= 80%";
  readonly paperworkLabel: "Paperwork <= 20%";
  readonly codingShareBps: number;
  readonly paperworkShareBps: number;
  readonly codingMeetsTarget: boolean;
  readonly paperworkMeetsTarget: boolean;
}

export interface SubscriptionWindow {
  readonly kind: WindowKind;
  readonly model: string;
  readonly percent: string;
  readonly ratio: number;
  readonly countdown: string;
  readonly kModel: string;
  readonly premiumRequests: number;
}

export interface AnalyticsModel {
  readonly routeId: "settings/usage";
  readonly activeTab: UsageTab;
  readonly api: {
    readonly estimated: MoneyBucket;
    readonly reported: MoneyBucket;
    readonly groups: {
      readonly byProject: readonly ApiAggregate[];
      readonly byFeature: readonly ApiAggregate[];
      readonly byPhase: readonly ApiAggregate[];
      readonly byModel: readonly ApiAggregate[];
    };
    readonly phase: PhaseHonesty;
  };
  readonly subscription: {
    readonly windows: readonly SubscriptionWindow[];
    readonly premiumRequests: number;
  };
  readonly local: {
    readonly tokens: number;
    readonly averageTokPerSec: number;
    readonly gpuMs: number;
    readonly cloudSpend: "$0.00";
    readonly cloudMicroUsd: 0;
  };
  readonly receipts: {
    readonly total: number;
    readonly rendered: readonly PublicReceipt[];
  };
}

function currencyFor(tab: UsageTab): UsageCurrency {
  if (tab === "subscription") return "allowance_ppm";
  if (tab === "local") return "local";
  return "micro_usd";
}

function emptyBucket(badge: string): MoneyBucket {
  return {
    badge,
    microUsd: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

function addBucket(bucket: MoneyBucket, row: ApiAggregate): MoneyBucket {
  return {
    badge: bucket.badge,
    microUsd: bucket.microUsd + row.microUsd,
    inputTokens: bucket.inputTokens + row.inputTokens,
    cachedTokens: bucket.cachedTokens + row.cachedTokens,
    outputTokens: bucket.outputTokens + row.outputTokens,
    reasoningTokens: bucket.reasoningTokens + row.reasoningTokens,
  };
}

function pricingText(row: ReceiptPageRow): string {
  if (row.currency === "local") return "$0.00";
  if (row.currency === "allowance_ppm") return `${percentFromPpm(row.allowanceUsedPpm)} of allowance`;
  if (row.pricingSource === "provider_reported") return REPORTED_BADGE;
  return estimatedBadge(row.priceTableVersion);
}

function costText(row: ReceiptPageRow): string {
  if (row.currency === "local") return "$0.00";
  if (row.currency === "allowance_ppm") return `${row.windowDeltaPpm} ppm`;
  return String(row.costMicroUsd);
}

function toPublic(row: ReceiptPageRow): PublicReceipt {
  return {
    timestamp: new Date(row.timestamp).toISOString(),
    project: row.project,
    taskId: row.taskId,
    role: row.role,
    connection: row.connection,
    model: row.model,
    inputTokens: row.inputTokens,
    cachedTokens: row.cachedTokens,
    outputTokens: row.outputTokens,
    costOrWindowDelta: costText(row),
    pricingSource: pricingText(row),
  };
}

export interface AnalyticsOptions {
  readonly nowMs: number;
  readonly pageSize?: number;
  readonly viewportRows?: number;
}

export class HonestUsageAnalyticsView {
  private tab: UsageTab = "api";
  private search = "";
  private offset = 0;
  private scroll = 0;
  private readonly pageSize: number;
  private readonly viewportRows: number;
  private readonly exporter = new UsageReceiptsCsvExporter();

  constructor(
    private readonly store: TelemetryReceiptStore,
    options: AnalyticsOptions,
  ) {
    this.nowMs = options.nowMs;
    this.pageSize = options.pageSize ?? 80;
    this.viewportRows = options.viewportRows ?? 40;
  }

  private nowMs: number;

  setTab(tab: UsageTab): void {
    this.tab = tab;
    this.offset = 0;
    this.scroll = 0;
  }

  setSearch(search: string): void {
    this.search = search;
    this.offset = 0;
    this.scroll = 0;
  }

  setPage(offset: number): void {
    this.offset = Math.max(0, offset);
    this.scroll = 0;
  }

  setScroll(index: number): void {
    this.scroll = Math.max(0, index);
  }

  load(): AnalyticsModel {
    const aggregates = this.store.apiAggregates();
    const projects = aggregates.filter((row) => row.axis === "project");
    let estimated = emptyBucket(estimatedBadge(""));
    let reported = emptyBucket(REPORTED_BADGE);
    const versions = new Set<string>();
    for (const row of projects) {
      if (row.pricingSource === "provider_reported") reported = addBucket(reported, row);
      else {
        estimated = addBucket(estimated, row);
        if (row.priceTableVersion !== "") versions.add(row.priceTableVersion);
      }
    }
    const version = [...versions].sort().join("+");
    estimated = { ...estimated, badge: estimatedBadge(version === "" ? "0" : version) };
    let codingTokens = 0;
    let paperworkTokens = 0;
    for (const row of aggregates) {
      if (row.axis !== "phase") continue;
      const tokens = row.inputTokens + row.cachedTokens + row.outputTokens + row.reasoningTokens;
      if (row.key === "paperwork") paperworkTokens += tokens;
      else codingTokens += tokens;
    }
    const totalTokens = codingTokens + paperworkTokens;
    const codingShareBps = totalTokens === 0 ? 0 : Math.round((codingTokens * 10_000) / totalTokens);
    const paperworkShareBps = totalTokens === 0 ? 0 : Math.round((paperworkTokens * 10_000) / totalTokens);
    const windows = this.store.windowAggregates().map((row) => ({
      kind: row.windowKind,
      model: row.model,
      percent: percentFromPpm(row.allowanceUsedPpm),
      ratio: Math.min(1, Math.max(0, row.allowanceUsedPpm / 1_000_000)),
      countdown: formatCountdown(row.resetAt - this.nowMs),
      kModel: row.kModel,
      premiumRequests: row.premiumRequests,
    }));
    const local = this.store.localAggregate();
    const currency = currencyFor(this.tab);
    const total = this.store.count({ currency, search: this.search });
    const page = this.store.page({
      currency,
      search: this.search,
      limit: this.pageSize,
      offset: this.offset,
    });
    const rendered = page.slice(this.scroll, this.scroll + this.viewportRows).map(toPublic);
    return {
      routeId: "settings/usage",
      activeTab: this.tab,
      api: {
        estimated,
        reported,
        groups: {
          byProject: projects,
          byFeature: aggregates.filter((row) => row.axis === "feature"),
          byPhase: aggregates.filter((row) => row.axis === "phase"),
          byModel: aggregates.filter((row) => row.axis === "model"),
        },
        phase: {
          codingLabel: "Coding >= 80%",
          paperworkLabel: "Paperwork <= 20%",
          codingShareBps,
          paperworkShareBps,
          codingMeetsTarget: codingShareBps >= 8_000,
          paperworkMeetsTarget: paperworkShareBps <= 2_000,
        },
      },
      subscription: {
        windows,
        premiumRequests: windows.reduce((sum, row) => sum + row.premiumRequests, 0),
      },
      local: {
        tokens: local.tokens,
        averageTokPerSec: local.averageTokPerSec,
        gpuMs: local.gpuMs,
        cloudSpend: "$0.00",
        cloudMicroUsd: 0,
      },
      receipts: { total, rendered },
    };
  }

  exportCsv(day: string): CsvExport {
    const currency = currencyFor(this.tab);
    const total = this.store.count({ currency, search: this.search });
    const rows = this.store.page({
      currency,
      search: this.search,
      limit: Math.max(total, 0),
      offset: 0,
    });
    return this.exporter.export(rows.map(toPublic), day);
  }
}
