import { UsageReceiptLedger, publicUsageReceipt } from "@ef-harness/shared-contracts";

export type {
  UsageApiAggregate as ApiAggregate,
  UsageCurrency,
  UsageLocalAggregate as LocalAggregate,
  UsagePhase,
  UsagePricingSource as PricingSource,
  UsageReceiptInput as UsageReceipt,
  UsageReceiptQuery as ReceiptQuery,
  UsageReceiptRow as ReceiptPageRow,
  UsageWindowAggregate as WindowAggregate,
  UsageWindowKind as WindowKind,
} from "@ef-harness/shared-contracts";

export { publicUsageReceipt };

/**
 * Settings → Connections usage cache. Rows are public receipt facts.
 * Persistence is `connections.usage` on harnessd (`telemetry.db`), not renderer sqlite.
 */
export class TelemetryReceiptStore extends UsageReceiptLedger {}
