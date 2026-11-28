import path from "node:path";
import type { GlobalBrokerDb, ProjectStateDb, TelemetryDb } from "@ef-harness/db";
import { WindowsDpapiSecretsVault } from "@ef-harness/governor";
import {
  ApiConnectionManager,
  ApiKeyGlobalDbConnections,
  CompliancePolicyLocks,
  LocalBudgetLedger,
  ZeroTokenApiKeyValidator,
} from "@ef-harness/providers";
import {
  USAGE_RECEIPT_SCHEMA,
  UsageReceiptLedger,
  publicUsageReceipt,
  type UsageReceiptInput,
  type UsageReceiptRow,
} from "@ef-harness/shared-contracts";

export interface ConnectionKeyContext {
  readonly broker: GlobalBrokerDb;
  readonly project: ProjectStateDb;
  readonly profileDir: string;
}

export interface ConnectionKeyParams {
  readonly projectId: string;
  readonly label: string;
  readonly rawKey: string;
  readonly provider: string;
}

export function rejectPastedConnectionKey(rawKey: string, provider: string): { readonly outcome: "rejected"; readonly message: string } | null {
  const decision = new CompliancePolicyLocks().inspectCredential({ secret: rawKey, provider });
  if (decision.allowed) return null;
  return { outcome: "rejected", message: decision.message };
}

export async function saveConnectionKey(
  ctx: ConnectionKeyContext,
  params: ConnectionKeyParams,
): Promise<unknown> {
  const rejected = rejectPastedConnectionKey(params.rawKey, params.provider);
  if (rejected) return rejected;
  const vault = new WindowsDpapiSecretsVault({
    global: ctx.broker,
    state: ctx.project,
    vaultDir: path.join(ctx.profileDir, "vault"),
  });
  const connections = new ApiKeyGlobalDbConnections(ctx.profileDir, ctx.broker);
  const manager = new ApiConnectionManager({
    vault: new BrokerKeyVault(vault, params.projectId),
    connections,
    ledger: new LocalBudgetLedger(),
    validator: new ZeroTokenApiKeyValidator({
      transport: {
        async request() {
          throw new Error("connections.saveKey lists models only after an explicit probe");
        },
      },
    }),
  });
  return manager.savePastedKey({
    rawKey: params.rawKey,
    label: params.label,
    offline: true,
  });
}

export function insertUsageReceipts(
  telemetry: TelemetryDb,
  receipts: readonly UsageReceiptInput[],
): { readonly written: number } {
  let written = 0;
  for (const receipt of receipts) {
    const row = publicUsageReceipt(receipt);
    telemetry.enqueue({
      attempt: row.taskId,
      ts: row.timestamp,
      kind: "metric",
      data: { schema: USAGE_RECEIPT_SCHEMA, receipt: row },
    });
    written += 1;
  }
  telemetry.flush();
  return { written };
}

export function loadUsageLedger(telemetry: TelemetryDb): UsageReceiptLedger {
  const ledger = new UsageReceiptLedger();
  let afterId = 0;
  for (;;) {
    const page = telemetry.readPage({ limit: 500, afterId });
    if (page.length === 0) break;
    const batch: UsageReceiptInput[] = [];
    for (const record of page) {
      const row = receiptFromMetric(record.data);
      if (row) batch.push(row);
    }
    if (batch.length > 0) ledger.insert(batch);
    const last = page[page.length - 1];
    if (!last || page.length < 500) break;
    afterId = last.id;
  }
  return ledger;
}

function receiptFromMetric(data: unknown): UsageReceiptRow | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { schema?: unknown; receipt?: unknown };
  if (record.schema !== USAGE_RECEIPT_SCHEMA || !record.receipt || typeof record.receipt !== "object") {
    return null;
  }
  return record.receipt as UsageReceiptRow;
}

class BrokerKeyVault {
  constructor(
    private readonly vault: WindowsDpapiSecretsVault,
    private readonly projectId: string,
  ) {}

  async storeSecret(input: {
    readonly secretId: string;
    readonly plaintext: string;
    readonly providerHint: string;
    readonly envScope: "test" | "dev" | "staging" | "prod";
  }): Promise<{
    readonly secretId: string;
    readonly name: string;
    readonly providerHint: string;
    readonly envScope: "test" | "dev" | "staging" | "prod";
    readonly lastFourMasked: string;
    readonly createdAt: number;
    readonly rotatedAt: number;
  }> {
    const saved = await this.vault.storeSecret({
      projectId: this.projectId,
      envScope: input.envScope,
      name: envName(input.secretId),
      value: input.plaintext,
      providerHint: input.providerHint,
      secretId: input.secretId,
    });
    return {
      secretId: saved.secretId,
      name: saved.name,
      providerHint: saved.providerHint ?? input.providerHint,
      envScope: saved.envScope,
      lastFourMasked: saved.lastFourMasked,
      createdAt: saved.createdAt,
      rotatedAt: saved.rotatedAt ?? saved.createdAt,
    };
  }

  async rotate(secretId: string, plaintext: string): Promise<{
    readonly secretId: string;
    readonly name: string;
    readonly providerHint: string;
    readonly envScope: "test" | "dev" | "staging" | "prod";
    readonly lastFourMasked: string;
    readonly createdAt: number;
    readonly rotatedAt: number;
  }> {
    const saved = await this.vault.rotate(secretId, plaintext);
    return {
      secretId: saved.metadata.secretId,
      name: saved.metadata.name,
      providerHint: saved.metadata.providerHint ?? "",
      envScope: saved.metadata.envScope,
      lastFourMasked: saved.metadata.lastFourMasked,
      createdAt: saved.metadata.createdAt,
      rotatedAt: saved.metadata.rotatedAt ?? saved.metadata.createdAt,
    };
  }

  async readPlaintextForKernel(secretId: string): Promise<string> {
    return this.vault.readPlaintextForKernel(secretId);
  }

  async deleteSecret(secretId: string): Promise<void> {
    await this.vault.deleteSecret(secretId);
  }

  async has(secretId: string): Promise<boolean> {
    const secret = await this.vault.readSecret(secretId);
    return secret !== null;
  }

  readAtRestBytes(): Uint8Array {
    return new Uint8Array();
  }
}

function envName(secretId: string): string {
  const cleaned = secretId.replace(/[^A-Za-z0-9_]/g, "_");
  return `API_KEY_${cleaned}`;
}
