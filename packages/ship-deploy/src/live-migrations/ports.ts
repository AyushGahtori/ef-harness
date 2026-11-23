import { createHash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { errorMessage } from "./errors.js";
import type {
  ApprovalCard,
  ApprovalDecision,
  ApprovalKind,
  BackupReceipt,
  SqlSession,
  SqlValue,
  TargetEnv,
} from "./types.js";

export interface EffectDraft {
  id: string;
  kind: string;
  target: string;
  payloadHash: string;
  idempotencyKey: string;
  approval: string | null;
  state: "intended" | "approved" | "sent" | "confirmed" | "failed" | "unknown";
  receipt: string | null;
}

export interface ExternalEffectLedger {
  record(effect: EffectDraft): void;
  update(id: string, state: EffectDraft["state"], receipt: string | null): void;
}

export interface EnvApprovalPolicyEngine {
  decide(card: ApprovalCard): ApprovalDecision;
}

export interface DeployAdapter {
  deploy(env: TargetEnv, commitSha: string, effectId: string): Promise<{
    deploymentId: string;
    liveUrl: string;
    buildId: string;
    previousDeploymentId: string;
  }>;
  rollback(
    env: TargetEnv,
    targetDeploymentId: string,
    effectId: string,
  ): Promise<{
    deploymentId: string;
    liveUrl: string;
    buildId: string;
    previousDeploymentId: string;
  }>;
}

export interface PostDeployHealthCheck {
  verify(input: {
    env: TargetEnv;
    commitSha: string;
    deploymentId: string;
    liveUrl: string;
    buildId: string;
  }): Promise<{ healthy: boolean; detail: string }>;
}

export interface DatabaseLocator {
  secretId: string;
  env: TargetEnv;
  locator: string;
}

export interface WindowsDpapiSecretsVault {
  resolveDatabaseLocator(secretId: string, env: TargetEnv): DatabaseLocator;
}

export interface SeedColumn {
  name: string;
  value(index: number): string | number | null;
}

export interface SeedSpec {
  table: string;
  primaryKey: string;
  rowCount: number;
  columns: readonly SeedColumn[];
}

export interface TemplateDbSeeder {
  seed(session: SqlSession, spec: SeedSpec): void;
}

export interface MigrationLintResult {
  ok: boolean;
  conflicts: readonly string[];
}

export interface MigrationIntentAndConflictLinter {
  lint(input: { migrationId: string; sql: string }): MigrationLintResult;
}

export interface DeprecatedObjectUseProbe {
  activeReferences(target: { table: string; column?: string }): readonly string[];
}

export interface BackupProvider {
  snapshot(input: {
    env: TargetEnv;
    session: SqlSession;
    destinationPath: string;
    tableToVerify?: string;
  }): Promise<BackupReceipt>;
}

export interface SqliteBackupSource {
  readonly native: DatabaseSync;
}

export function isSqliteBackupSource(session: SqlSession): session is SqlSession & SqliteBackupSource {
  return "native" in session && session.native instanceof DatabaseSync;
}

export function canonicalPayload(payload: ApprovalCard["payload"]): string {
  const keys = Object.keys(payload).sort();
  const sorted: Record<string, string | number | boolean | null> = {};
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined) sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

export function hashPayload(payload: ApprovalCard["payload"]): string {
  return createHash("sha256").update(canonicalPayload(payload)).digest("hex");
}

export function sha256FileBytes(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildApprovalCard(input: {
  migrationId: string;
  env: TargetEnv;
  kind: ApprovalKind;
  payload: ApprovalCard["payload"];
}): ApprovalCard {
  const loud = input.kind === "destructive_contract" || input.env === "production";
  const title =
    input.kind === "destructive_contract"
      ? "Production Destructive Contract ApprovalCard"
      : `${input.env} ${input.kind} ApprovalCard`;
  return {
    cardId: `${input.migrationId}:${input.kind}:${hashPayload(input.payload).slice(0, 12)}`,
    title,
    env: input.env,
    kind: input.kind,
    loud,
    payload: input.payload,
    payloadHash: hashPayload(input.payload),
  };
}

export class PayloadBoundApprovalPolicy implements EnvApprovalPolicyEngine {
  readonly cards: ApprovalCard[] = [];

  constructor(private readonly mode: "approve" | "deny" = "approve") {}

  decide(card: ApprovalCard): ApprovalDecision {
    this.cards.push(card);
    if (card.payloadHash !== hashPayload(card.payload)) {
      return { approved: false, payloadHash: card.payloadHash, reason: "approval_stale_payload_changed" };
    }
    if (card.env === "preview" && card.kind !== "destructive_contract") {
      return { approved: true, payloadHash: card.payloadHash, reason: "preview-auto" };
    }
    if (this.mode === "deny") {
      return { approved: false, payloadHash: card.payloadHash, reason: "explicit-approval-required" };
    }
    return { approved: true, payloadHash: card.payloadHash, reason: "payload-bound-approved" };
  }
}

export class LocalTemplateDbSeeder implements TemplateDbSeeder {
  seed(session: SqlSession, spec: SeedSpec): void {
    if (!Number.isInteger(spec.rowCount) || spec.rowCount < 0) {
      throw new Error("rowCount must be a non-negative integer");
    }
    const columns = [spec.primaryKey, ...spec.columns.map((column) => column.name)];
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT INTO ${quote(spec.table)} (${columns.map((column) => quote(column)).join(", ")}) VALUES (${placeholders})`;
    session.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 1; index <= spec.rowCount; index += 1) {
        const values: SqlValue[] = [index];
        for (const column of spec.columns) values.push(column.value(index));
        session.run(sql, values);
      }
      session.exec("COMMIT");
    } catch (error) {
      session.exec("ROLLBACK");
      throw error;
    }
  }
}

export class PermissiveMigrationLinter implements MigrationIntentAndConflictLinter {
  constructor(private readonly conflicts: readonly string[] = []) {}

  lint(): MigrationLintResult {
    return { ok: this.conflicts.length === 0, conflicts: this.conflicts };
  }
}

export class MapDatabaseVault implements WindowsDpapiSecretsVault {
  constructor(private readonly locators: ReadonlyMap<string, string>) {}

  resolveDatabaseLocator(secretId: string, env: TargetEnv): DatabaseLocator {
    const locator = this.locators.get(`${env}:${secretId}`) ?? this.locators.get(secretId);
    if (!locator) {
      throw new Error(`database locator missing for ${secretId}`);
    }
    return { secretId, env, locator };
  }
}

export class StaticReferenceProbe implements DeprecatedObjectUseProbe {
  constructor(private readonly references: readonly string[] = []) {}

  activeReferences(): readonly string[] {
    return this.references;
  }
}

export function pgDumpArgs(databaseLocator: string, outputPath: string): string[] {
  return ["pg_dump", "--format=custom", "--file", outputPath, databaseLocator];
}

export class ProviderBackup implements BackupProvider {
  constructor(
    private readonly run: (args: readonly string[]) => Promise<BackupReceipt | { ok: false; detail: string }>,
  ) {}

  async snapshot(input: {
    env: TargetEnv;
    session: SqlSession;
    destinationPath: string;
    tableToVerify?: string;
  }): Promise<BackupReceipt> {
    if (input.session.dialect === "sqlite" && isSqliteBackupSource(input.session)) {
      return sqliteOnlineBackup(input.session, input.destinationPath, input.tableToVerify);
    }
    const locator = input.destinationPath;
    const result = await this.run(pgDumpArgs(locator, input.destinationPath));
    if ("ok" in result) {
      throw new Error(result.detail);
    }
    return result;
  }
}

export async function sqliteOnlineBackup(
  session: SqlSession & SqliteBackupSource,
  destinationPath: string,
  tableToVerify?: string,
): Promise<BackupReceipt> {
  try {
    await backup(session.native, destinationPath);
  } catch (error) {
    throw new Error(`sqlite online backup failed: ${errorMessage(error)}`);
  }
  const { readFileSync } = await import("node:fs");
  const checksumSha256 = sha256FileBytes(readFileSync(destinationPath));
  const copy = new DatabaseSync(destinationPath, { readOnly: true });
  try {
    const quick = copy.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    const quickValue = quick ? Object.values(quick)[0] : undefined;
    if (quickValue !== "ok") {
      return {
        artifactPath: destinationPath,
        checksumSha256,
        verified: false,
        method: "sqlite-online-backup",
        detail: `quick_check ${String(quickValue)}`,
        rowCount: null,
      };
    }
    let rowCount: number | null = null;
    if (tableToVerify) {
      const countRow = copy.prepare(`SELECT COUNT(*) AS c FROM ${quote(tableToVerify)}`).get() as
        | Record<string, unknown>
        | undefined;
      const count = countRow?.c;
      rowCount = typeof count === "number" ? count : typeof count === "bigint" ? Number(count) : null;
    }
    const reread = sha256FileBytes(readFileSync(destinationPath));
    return {
      artifactPath: destinationPath,
      checksumSha256,
      verified: reread === checksumSha256,
      method: "sqlite-online-backup",
      detail: "sqlite online backup API verified with quick_check",
      rowCount,
    };
  } finally {
    copy.close();
  }
}

function quote(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}
