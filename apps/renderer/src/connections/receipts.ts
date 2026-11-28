import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

export type UsageCurrency = "micro_usd" | "allowance_ppm" | "local";
export type UsagePhase = "coding" | "paperwork";
export type PricingSource = "estimated" | "provider_reported";
export type WindowKind = "5h" | "weekly" | "monthly";

export interface UsageReceipt {
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

export interface ReceiptPageRow {
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

export interface ApiAggregate {
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

export interface WindowAggregate {
  readonly windowKind: WindowKind;
  readonly model: string;
  readonly allowanceUsedPpm: number;
  readonly resetAt: number;
  readonly kModel: string;
  readonly premiumRequests: number;
}

export interface LocalAggregate {
  readonly tokens: number;
  readonly averageTokPerSec: number;
  readonly gpuMs: number;
  readonly cloudMicroUsd: 0;
}

export interface ReceiptQuery {
  readonly currency: UsageCurrency;
  readonly search: string;
  readonly limit: number;
  readonly offset: number;
}

function num(value: SQLOutputValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function text(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function likePattern(search: string): string {
  const escaped = search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return `%${escaped}%`;
}

const FACT_FIELDS = `
  ts AS timestamp,
  project,
  feature,
  task_id AS taskId,
  role,
  connection,
  model,
  phase,
  currency,
  input_tokens AS inputTokens,
  cached_tokens AS cachedTokens,
  output_tokens AS outputTokens,
  reasoning_tokens AS reasoningTokens,
  cost_micro_usd AS costMicroUsd,
  window_delta_ppm AS windowDeltaPpm,
  premium_requests AS premiumRequests,
  tok_per_sec AS tokPerSec,
  gpu_ms AS gpuMs,
  pricing_source AS pricingSource,
  price_table_version AS priceTableVersion,
  provider,
  k_model AS kModel,
  window_kind AS windowKind,
  allowance_used_ppm AS allowanceUsedPpm,
  reset_at AS resetAt
`;

function whereFact(search: string): { sql: string; params: string[] } {
  const filters = ["currency = ?"];
  const params: string[] = [];
  if (search !== "") {
    filters.push(
      "(project LIKE ? ESCAPE '\\' OR task_id LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR connection LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\' OR feature LIKE ? ESCAPE '\\')",
    );
    const pattern = likePattern(search);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: filters.join(" AND "), params };
}

function mapFact(row: Record<string, SQLOutputValue>): ReceiptPageRow {
  const phase = text(row.phase) === "paperwork" ? "paperwork" : "coding";
  const currencyText = text(row.currency);
  const currency: UsageCurrency =
    currencyText === "allowance_ppm" || currencyText === "local" ? currencyText : "micro_usd";
  const pricing = text(row.pricingSource) === "provider_reported" ? "provider_reported" : "estimated";
  const windowText = text(row.windowKind);
  const windowKind: WindowKind = windowText === "weekly" || windowText === "monthly" ? windowText : "5h";
  return {
    timestamp: num(row.timestamp),
    project: text(row.project),
    feature: text(row.feature),
    taskId: text(row.taskId),
    role: text(row.role),
    connection: text(row.connection),
    model: text(row.model),
    phase,
    currency,
    inputTokens: num(row.inputTokens),
    cachedTokens: num(row.cachedTokens),
    outputTokens: num(row.outputTokens),
    reasoningTokens: num(row.reasoningTokens),
    costMicroUsd: num(row.costMicroUsd),
    windowDeltaPpm: num(row.windowDeltaPpm),
    premiumRequests: num(row.premiumRequests),
    tokPerSec: num(row.tokPerSec),
    gpuMs: num(row.gpuMs),
    pricingSource: pricing,
    priceTableVersion: text(row.priceTableVersion),
    provider: text(row.provider),
    kModel: text(row.kModel),
    windowKind,
    allowanceUsedPpm: num(row.allowanceUsedPpm),
    resetAt: num(row.resetAt),
  };
}

export class TelemetryReceiptStore {
  private readonly db: DatabaseSync;

  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry (
        id      INTEGER PRIMARY KEY,
        attempt TEXT,
        ts      INTEGER NOT NULL,
        kind    TEXT NOT NULL,
        data    TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS telemetry_attempt ON telemetry(attempt, ts);
      CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry(ts);
      CREATE TABLE IF NOT EXISTS usage_receipt_fact (
        id INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        project TEXT NOT NULL,
        feature TEXT NOT NULL,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        connection TEXT NOT NULL,
        model TEXT NOT NULL,
        phase TEXT NOT NULL,
        currency TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL,
        cost_micro_usd INTEGER NOT NULL,
        window_delta_ppm INTEGER NOT NULL,
        premium_requests INTEGER NOT NULL,
        tok_per_sec REAL NOT NULL,
        gpu_ms INTEGER NOT NULL,
        pricing_source TEXT NOT NULL,
        price_table_version TEXT NOT NULL,
        provider TEXT NOT NULL,
        k_model TEXT NOT NULL,
        window_kind TEXT NOT NULL,
        allowance_used_ppm INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS usage_receipt_fact_currency_ts ON usage_receipt_fact(currency, ts DESC, id DESC);
      CREATE TABLE IF NOT EXISTS usage_api_summary (
        axis TEXT NOT NULL,
        bucket TEXT NOT NULL,
        pricing_source TEXT NOT NULL,
        price_table_version TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL,
        micro_usd INTEGER NOT NULL,
        PRIMARY KEY (axis, bucket, pricing_source, price_table_version, provider)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS usage_window_summary (
        window_kind TEXT NOT NULL,
        model TEXT NOT NULL,
        allowance_used_ppm INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
        k_model TEXT NOT NULL,
        premium_requests INTEGER NOT NULL,
        PRIMARY KEY (window_kind, model)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS usage_local_summary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tokens INTEGER NOT NULL,
        tok_sum REAL NOT NULL,
        samples INTEGER NOT NULL,
        gpu_ms INTEGER NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO usage_local_summary (id, tokens, tok_sum, samples, gpu_ms) VALUES (1, 0, 0, 0, 0);
      CREATE TABLE IF NOT EXISTS usage_currency_count (
        currency TEXT PRIMARY KEY,
        total INTEGER NOT NULL
      ) STRICT;
    `);
  }

  insert(receipts: readonly UsageReceipt[]): void {
    const statement = this.db.prepare(
      "INSERT INTO telemetry (attempt, ts, kind, data) VALUES (?, ?, 'usage_receipt', ?)",
    );
    const rowId = this.db.prepare("SELECT last_insert_rowid() AS id");
    const fact = this.db.prepare(
      `INSERT INTO usage_receipt_fact (
        id, ts, project, feature, task_id, role, connection, model, phase, currency,
        input_tokens, cached_tokens, output_tokens, reasoning_tokens, cost_micro_usd,
        window_delta_ppm, premium_requests, tok_per_sec, gpu_ms, pricing_source,
        price_table_version, provider, k_model, window_kind, allowance_used_ppm, reset_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const countBump = this.db.prepare(
      `INSERT INTO usage_currency_count (currency, total) VALUES (?, 1)
       ON CONFLICT(currency) DO UPDATE SET total = total + 1`,
    );
    const apiBump = this.db.prepare(
      `INSERT INTO usage_api_summary (
        axis, bucket, pricing_source, price_table_version, provider,
        input_tokens, cached_tokens, output_tokens, reasoning_tokens, micro_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(axis, bucket, pricing_source, price_table_version, provider) DO UPDATE SET
        input_tokens = input_tokens + excluded.input_tokens,
        cached_tokens = cached_tokens + excluded.cached_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
        micro_usd = micro_usd + excluded.micro_usd`,
    );
    const windowBump = this.db.prepare(
      `INSERT INTO usage_window_summary (
        window_kind, model, allowance_used_ppm, reset_at, k_model, premium_requests
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(window_kind, model) DO UPDATE SET
        allowance_used_ppm = MAX(allowance_used_ppm, excluded.allowance_used_ppm),
        reset_at = MAX(reset_at, excluded.reset_at),
        k_model = MAX(k_model, excluded.k_model),
        premium_requests = premium_requests + excluded.premium_requests`,
    );
    const localBump = this.db.prepare(
      `UPDATE usage_local_summary
       SET tokens = tokens + ?, tok_sum = tok_sum + ?, samples = samples + 1, gpu_ms = gpu_ms + ?
       WHERE id = 1`,
    );
    this.db.exec("BEGIN");
    try {
      for (const receipt of receipts) {
        const payload = publicPayload(receipt);
        statement.run(payload.taskId, payload.timestamp, JSON.stringify(payload));
        const id = num(rowId.get()?.id);
        fact.run(
          id,
          payload.timestamp,
          payload.project,
          payload.feature,
          payload.taskId,
          payload.role,
          payload.connection,
          payload.model,
          payload.phase,
          payload.currency,
          payload.inputTokens,
          payload.cachedTokens,
          payload.outputTokens,
          payload.reasoningTokens,
          payload.costMicroUsd,
          payload.windowDeltaPpm,
          payload.premiumRequests,
          payload.tokPerSec,
          payload.gpuMs,
          payload.pricingSource,
          payload.priceTableVersion,
          payload.provider,
          payload.kModel,
          payload.windowKind,
          payload.allowanceUsedPpm,
          payload.resetAt,
        );
        countBump.run(payload.currency);
        if (payload.currency === "micro_usd") {
          const axes = [
            ["project", payload.project],
            ["feature", payload.feature],
            ["phase", payload.phase],
            ["model", payload.model],
          ] as const;
          for (const [axis, bucket] of axes) {
            apiBump.run(
              axis,
              bucket,
              payload.pricingSource,
              payload.priceTableVersion,
              payload.provider,
              payload.inputTokens,
              payload.cachedTokens,
              payload.outputTokens,
              payload.reasoningTokens,
              payload.costMicroUsd,
            );
          }
        } else if (payload.currency === "allowance_ppm") {
          windowBump.run(
            payload.windowKind,
            payload.model,
            payload.allowanceUsedPpm,
            payload.resetAt,
            payload.kModel,
            payload.premiumRequests,
          );
        } else {
          localBump.run(
            payload.inputTokens + payload.outputTokens,
            payload.tokPerSec,
            payload.gpuMs,
          );
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  count(query: Pick<ReceiptQuery, "currency" | "search">): number {
    if (query.search === "") {
      const row = this.db
        .prepare("SELECT total FROM usage_currency_count WHERE currency = ?")
        .get(query.currency);
      return num(row?.total);
    }
    const filter = whereFact(query.search);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM usage_receipt_fact WHERE ${filter.sql}`)
      .get(query.currency, ...filter.params);
    return num(row?.total);
  }

  page(query: ReceiptQuery): ReceiptPageRow[] {
    const filter = whereFact(query.search);
    const rows = this.db
      .prepare(
        `SELECT ${FACT_FIELDS} FROM usage_receipt_fact WHERE ${filter.sql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(query.currency, ...filter.params, query.limit, query.offset);
    return rows.map((row) => mapFact(row));
  }

  apiAggregates(): ApiAggregate[] {
    const rows = this.db
      .prepare(
        `SELECT axis, bucket, pricing_source AS pricingSource, price_table_version AS priceTableVersion,
                provider, input_tokens AS inputTokens, cached_tokens AS cachedTokens,
                output_tokens AS outputTokens, reasoning_tokens AS reasoningTokens, micro_usd AS microUsd
         FROM usage_api_summary`,
      )
      .all();
    return rows.map((row) => {
      const axisText = text(row.axis);
      const axis = axisText === "feature" || axisText === "phase" || axisText === "model" ? axisText : "project";
      const pricing = text(row.pricingSource) === "provider_reported" ? "provider_reported" : "estimated";
      return {
        axis,
        key: text(row.bucket),
        pricingSource: pricing,
        priceTableVersion: text(row.priceTableVersion),
        provider: text(row.provider),
        inputTokens: num(row.inputTokens),
        cachedTokens: num(row.cachedTokens),
        outputTokens: num(row.outputTokens),
        reasoningTokens: num(row.reasoningTokens),
        microUsd: num(row.microUsd),
      };
    });
  }

  windowAggregates(): WindowAggregate[] {
    const rows = this.db
      .prepare(
        `SELECT window_kind AS windowKind, model, allowance_used_ppm AS allowanceUsedPpm,
                reset_at AS resetAt, k_model AS kModel, premium_requests AS premiumRequests
         FROM usage_window_summary`,
      )
      .all();
    return rows.map((row) => {
      const windowText = text(row.windowKind);
      const windowKind: WindowKind = windowText === "weekly" || windowText === "monthly" ? windowText : "5h";
      return {
        windowKind,
        model: text(row.model),
        allowanceUsedPpm: num(row.allowanceUsedPpm),
        resetAt: num(row.resetAt),
        kModel: text(row.kModel),
        premiumRequests: num(row.premiumRequests),
      };
    });
  }

  localAggregate(): LocalAggregate {
    const row = this.db
      .prepare("SELECT tokens, tok_sum AS tokSum, samples, gpu_ms AS gpuMs FROM usage_local_summary WHERE id = 1")
      .get();
    const samples = num(row?.samples);
    const tokSum = num(row?.tokSum);
    return {
      tokens: num(row?.tokens),
      averageTokPerSec: samples === 0 ? 0 : Math.round(tokSum / samples),
      gpuMs: num(row?.gpuMs),
      cloudMicroUsd: 0,
    };
  }

  persistedDataIncludes(needle: string): boolean {
    const rows = this.db.prepare("SELECT data FROM telemetry").all();
    return rows.some((row) => text(row.data).includes(needle));
  }

  close(): void {
    this.db.close();
  }
}

function publicPayload(receipt: UsageReceipt): ReceiptPageRow {
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
