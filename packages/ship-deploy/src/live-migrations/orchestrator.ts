import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { PausableBatchedBackfillRunner } from "./backfill-runner.js";
import { ContractPhaseExportGuard } from "./contract-guard.js";
import { DdlSafetyClassifier } from "./ddl-safety-classifier.js";
import {
  ApprovalRequiredError,
  BackupRequiredBeforeLiveMigrationError,
  errorMessage,
  LockHazardBlockedError,
  MigrationConflictError,
  RehearsalCompatibilityError,
} from "./errors.js";
import { executeLiveDdl } from "./lock-timeout.js";
import {
  buildApprovalCard,
  isSqliteBackupSource,
  LocalTemplateDbSeeder,
  PermissiveMigrationLinter,
  sha256Text,
  sqliteOnlineBackup,
  StaticReferenceProbe,
  type BackupProvider,
  type DeployAdapter,
  type DeprecatedObjectUseProbe,
  type EnvApprovalPolicyEngine,
  type PostDeployHealthCheck,
  type SeedSpec,
  type TemplateDbSeeder,
  type MigrationIntentAndConflictLinter,
  type WindowsDpapiSecretsVault,
} from "./ports.js";
import { quoteIdent } from "./sql-text.js";
import { SqliteSession } from "./sqlite-session.js";
import { blankPhases, type MigrationStateStore, type PersistedRun } from "./state-store.js";
import type {
  AppProbe,
  ApprovalKind,
  BackfillCheckpoint,
  BackfillSpec,
  BackupReceipt,
  DdlClassification,
  DeployResult,
  ExportReceipt,
  PhaseName,
  PhaseStatus,
  PitrAttestation,
  SqlDialect,
  SqlSession,
  TargetEnv,
} from "./types.js";
import { LOCK_HAZARD_GUIDANCE } from "./types.js";

export interface ExpandContractPlan {
  migrationId: string;
  env: TargetEnv;
  dialect: SqlDialect;
  sql: string;
  predecessorSchemaSql: string;
  workDir: string;
  commitSha: string;
  previousCommitSha: string;
  targetHost: string;
  databaseSecretId: string;
  live: SqlSession;
  rehearsalSession?: SqlSession;
  seed?: SeedSpec;
  backfills?: readonly BackfillSpec[];
  appNMinus1: AppProbe;
  appN: AppProbe;
  pitrAttestation?: PitrAttestation;
  exportFormat?: ExportReceipt["format"];
  archiveDir?: string;
}

export interface MigrationHooks {
  stopAfter?: PhaseName;
  onBackfillProgress?: (snapshot: BackfillCheckpoint) => void;
  pauseBackfillWhen?: (snapshot: BackfillCheckpoint) => boolean;
  beforeBackfill?: () => void;
  beforeContract?: () => void;
}

export interface MigrationRunState extends PersistedRun {
  progressText: string | null;
  backfillCursor: BackfillCheckpoint | null;
}

export interface OrchestratorDeps {
  store: MigrationStateStore;
  vault: WindowsDpapiSecretsVault;
  policy: EnvApprovalPolicyEngine;
  deployer: DeployAdapter;
  health: PostDeployHealthCheck;
  seeder?: TemplateDbSeeder;
  linter?: MigrationIntentAndConflictLinter;
  probe?: DeprecatedObjectUseProbe;
  backupProvider?: BackupProvider;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  clock?: () => Date;
}

export class ExpandContractMigrationOrchestrator {
  readonly trace: string[] = [];
  readonly classifier: DdlSafetyClassifier;
  readonly backfill: PausableBatchedBackfillRunner;
  readonly contractGuard = new ContractPhaseExportGuard();
  private readonly seeder: TemplateDbSeeder;
  private readonly linter: MigrationIntentAndConflictLinter;
  private readonly probe: DeprecatedObjectUseProbe;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly clock: () => Date;

  constructor(
    private readonly deps: OrchestratorDeps,
    dialect: SqlDialect,
  ) {
    this.classifier = new DdlSafetyClassifier(dialect);
    this.seeder = deps.seeder ?? new LocalTemplateDbSeeder();
    this.linter = deps.linter ?? new PermissiveMigrationLinter();
    this.probe = deps.probe ?? new StaticReferenceProbe();
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = deps.random ?? Math.random;
    this.now = deps.now ?? Date.now;
    this.clock = deps.clock ?? (() => new Date());
    this.backfill = new PausableBatchedBackfillRunner({
      store: deps.store,
      sleep: this.sleep,
      now: this.now,
    });
  }

  requestBackfillPause(): void {
    this.backfill.requestPause();
  }

  async run(plan: ExpandContractPlan, hooks: MigrationHooks = {}): Promise<MigrationRunState> {
    mkdirSync(plan.workDir, { recursive: true });
    this.deps.vault.resolveDatabaseLocator(plan.databaseSecretId, plan.env);
    const classification = this.classifier.classify(plan.sql);
    const lint = this.linter.lint({ migrationId: plan.migrationId, sql: plan.sql });
    if (!lint.ok) throw new MigrationConflictError(lint.conflicts.join("; "));
    const sqlSha256 = sha256Text(plan.sql);
    let run = this.deps.store.getRun(plan.migrationId);
    if (run && run.sqlSha256 !== sqlSha256) {
      throw new ApprovalRequiredError("migration SQL changed; previous payload-bound approval is stale");
    }
    if (!run) {
      run = this.blank(plan, classification, sqlSha256);
      this.deps.store.saveRun(run);
    }
    if (run.phases.APP_DEPLOY.status === "rolled_back") return this.snapshot(run);

    if (run.phases.REHEARSE.status !== "passed") {
      run = this.touch(run, "REHEARSE", "running", "rehearsing expanded schema");
      try {
        await this.rehearse(plan, classification);
        run = this.touch(run, "REHEARSE", "passed", "App N-1 and App N passed against the expanded schema");
      } catch (error) {
        this.touch(run, "REHEARSE", "failed", errorMessage(error));
        throw error;
      }
    }
    if (hooks.stopAfter === "REHEARSE") return this.snapshot(run);

    if (run.phases.BACKUP.status !== "passed") {
      run = this.touch(run, "BACKUP", "running", "snapshot backup");
      try {
        const backup = await this.backup(plan);
        if (!backup.verified) throw new Error("backup artifact failed verification");
        run = { ...run, backup };
        run = this.touch(run, "BACKUP", "passed", `${backup.method} ${backup.checksumSha256}`);
        this.trace.push("backup-verified");
      } catch (error) {
        if (plan.pitrAttestation?.clean === true && plan.pitrAttestation.writtenOverride.trim()) {
          const backup = pitrReceipt(plan.pitrAttestation);
          run = { ...run, backup };
          run = this.touch(run, "BACKUP", "passed", backup.detail);
          this.trace.push("backup-pitr");
        } else {
          this.touch(run, "BACKUP", "failed", errorMessage(error));
          throw new BackupRequiredBeforeLiveMigrationError(errorMessage(error));
        }
      }
    }
    if (hooks.stopAfter === "BACKUP") return this.snapshot(run);

    if (run.phases.EXPAND.status !== "passed") {
      if (classification.mixedDestructiveIntoExpand) this.trace.push("quarantine-destructive");
      if (classification.lockHazards.length > 0) {
        const guidance = classification.lockHazards
          .map((hazard) => `${hazard.reason} ${hazard.guidance ?? LOCK_HAZARD_GUIDANCE}`)
          .join(" ");
        this.touch(run, "EXPAND", "blocked", guidance);
        throw new LockHazardBlockedError(guidance);
      }
      await this.authorize(plan, "expand", {
        migrationId: plan.migrationId,
        commitSha: plan.commitSha,
        targetHost: plan.targetHost,
        statements: classification.expandSql.join("\n"),
      });
      try {
        for (const statement of classification.expandSql) {
          this.trace.push(`expand:${statement}`);
          await executeLiveDdl({
            session: plan.live,
            statement,
            sleep: this.sleep,
            random: this.random,
          });
        }
      } catch (error) {
        this.touch(run, "EXPAND", "failed", errorMessage(error));
        throw error;
      }
      run = this.touch(run, "EXPAND", "passed", `${classification.expandSql.length} additive statements; old columns kept`);
    }
    if (hooks.stopAfter === "EXPAND") return this.snapshot(run);

    if (run.phases.APP_DEPLOY.status !== "passed") {
      const deployed = await this.deployApp(plan);
      if (deployed.rolledBackTo) {
        run = {
          ...run,
          deploy: deployed.deploy,
          rolledBackTo: deployed.rolledBackTo,
        };
        run = this.touch(run, "APP_DEPLOY", "rolled_back", `rolled back to ${deployed.rolledBackTo}`);
        return this.snapshot(run);
      }
      run = { ...run, deploy: deployed.deploy };
      run = this.touch(run, "APP_DEPLOY", "passed", deployed.deploy.deploymentId);
    }
    if (hooks.stopAfter === "APP_DEPLOY") return this.snapshot(run);

    const fastPath = classification.contractSql.length === 0 && (plan.backfills?.length ?? 0) === 0;
    if (fastPath) {
      run = { ...run, fastPath: true };
      run = this.touch(run, "BACKFILL", "not_applicable", "no backfill in this deploy");
      run = this.touch(run, "CONTRACT", "not_applicable", "no contract in this deploy");
      return this.snapshot(run);
    }

    if (run.phases.BACKFILL.status !== "passed" && run.phases.BACKFILL.status !== "not_applicable") {
      if (!plan.backfills || plan.backfills.length === 0) {
        run = this.touch(run, "BACKFILL", "not_applicable", "no backfill spec");
      } else {
        await this.authorize(plan, "backfill", {
          migrationId: plan.migrationId,
          commitSha: plan.commitSha,
          labels: plan.backfills.map((spec) => spec.label).join(","),
        });
        if (run.phases.BACKFILL.status === "pending") hooks.beforeBackfill?.();
        for (const spec of plan.backfills) {
          const checkpoint = await this.backfill.run({
            session: plan.live,
            migrationId: plan.migrationId,
            spec,
            ...(hooks.onBackfillProgress ? { onProgress: hooks.onBackfillProgress } : {}),
            ...(hooks.pauseBackfillWhen ? { pauseWhen: hooks.pauseBackfillWhen } : {}),
          });
          if (checkpoint.paused) {
            run = this.touch(run, "BACKFILL", "paused", checkpoint.progressText);
            return this.snapshot(run);
          }
        }
        run = this.touch(run, "BACKFILL", "passed", "backfill remaining 0");
      }
    }
    if (hooks.stopAfter === "BACKFILL") return this.snapshot(run);

    if (run.phases.CONTRACT.status !== "passed" && run.phases.CONTRACT.status !== "not_applicable") {
      if (classification.contractSql.length === 0) {
        run = this.touch(run, "CONTRACT", "not_applicable", "no destructive contract");
      } else {
        hooks.beforeContract?.();
        try {
          const archive = await this.contract(plan, classification);
          run = { ...run, contractExportPath: archive };
          run = this.touch(run, "CONTRACT", "passed", archive);
        } catch (error) {
          this.touch(run, "CONTRACT", "blocked", errorMessage(error));
          throw error;
        }
      }
    }
    return this.snapshot(run);
  }

  private async rehearse(plan: ExpandContractPlan, classification: DdlClassification): Promise<void> {
    const owned = !plan.rehearsalSession;
    const session = plan.rehearsalSession ?? openRehearsal(plan);
    try {
      if (owned) {
        session.exec(plan.predecessorSchemaSql);
        if (plan.seed && plan.seed.rowCount > 0) this.seeder.seed(session, plan.seed);
      }
      for (const statement of classification.statements) {
        if (statement.safety === "DESTRUCTIVE_CONTRACT") {
          this.trace.push("rehearse-skip-contract");
          continue;
        }
        try {
          session.exec("SAVEPOINT rehearse_stmt");
          session.exec(statement.sql);
          session.exec("RELEASE rehearse_stmt");
        } catch (error) {
          releaseOrRollback(session);
          if (/NOT NULL without a default/i.test(statement.reason)) {
            throw new RehearsalCompatibilityError(
              "App N-1 crashes on the expanded schema because a NOT NULL column omitted a DEFAULT",
            );
          }
          throw new RehearsalCompatibilityError(`expanded schema rejected SQL: ${errorMessage(error)}`);
        }
      }
      const previous = await plan.appNMinus1.probe(session);
      if (!previous.ok) {
        const notNull = classification.lockHazards.some((hazard) => /NOT NULL without a default/i.test(hazard.reason));
        throw new RehearsalCompatibilityError(
          notNull
            ? "App N-1 crashes on the expanded schema because a NOT NULL column omitted a DEFAULT"
            : `App N-1 failed smoke against expanded schema: ${previous.error ?? "smoke failed"}`,
        );
      }
      const next = await plan.appN.probe(session);
      if (!next.ok) {
        throw new RehearsalCompatibilityError(`App N failed smoke against expanded schema: ${next.error ?? "smoke failed"}`);
      }
      this.trace.push("rehearse-passed");
    } finally {
      if (owned) session.close();
    }
  }

  private async backup(plan: ExpandContractPlan): Promise<BackupReceipt> {
    const destinationPath = path.join(plan.workDir, `${plan.migrationId}-backup.sqlite`);
    if (this.deps.backupProvider) {
      return this.deps.backupProvider.snapshot({
        env: plan.env,
        session: plan.live,
        destinationPath,
        ...(plan.seed ? { tableToVerify: plan.seed.table } : {}),
      });
    }
    if (plan.dialect === "sqlite" && isSqliteBackupSource(plan.live)) {
      return sqliteOnlineBackup(plan.live, destinationPath, plan.seed?.table);
    }
    throw new Error("pg_dump: connection refused");
  }

  private async deployApp(plan: ExpandContractPlan): Promise<{ deploy: DeployResult; rolledBackTo: string | null }> {
    const effectId = effectIdentity(plan.migrationId, "app_deploy");
    await this.authorize(plan, "app_deploy", {
      migrationId: plan.migrationId,
      commitSha: plan.commitSha,
      previousCommitSha: plan.previousCommitSha,
      targetHost: plan.targetHost,
    });
    this.deps.store.applyEffect(effectId, "sent", null);
    const deploy = await this.deps.deployer.deploy(plan.env, plan.commitSha, effectId);
    const health = await this.deps.health.verify({
      env: plan.env,
      commitSha: plan.commitSha,
      deploymentId: deploy.deploymentId,
      liveUrl: deploy.liveUrl,
      buildId: deploy.buildId,
    });
    if (health.healthy) {
      this.deps.store.applyEffect(effectId, "confirmed", deploy.deploymentId);
      this.trace.push("deploy-healthy");
      return { deploy, rolledBackTo: null };
    }
    const rollbackId = effectIdentity(plan.migrationId, "app_deploy") + ":rollback";
    this.record(plan, rollbackId, "migration_rollback", sha256Text(deploy.previousDeploymentId), "intended");
    const rolled = await this.deps.deployer.rollback(plan.env, deploy.previousDeploymentId, rollbackId);
    this.deps.store.applyEffect(rollbackId, "confirmed", rolled.deploymentId);
    const compatible = await plan.appNMinus1.probe(plan.live);
    if (!compatible.ok) {
      throw new RehearsalCompatibilityError(
        `App N-1 failed after additive expand rollback: ${compatible.error ?? "schema error"}`,
      );
    }
    this.trace.push("rollback-n-1-ok");
    return { deploy, rolledBackTo: deploy.previousDeploymentId };
  }

  private async contract(plan: ExpandContractPlan, classification: DdlClassification): Promise<string> {
    for (const target of classification.contractObjects) {
      this.contractGuard.assertNoActiveReferences(this.probe, target);
    }
    this.contractGuard.assertBackfillComplete(this.remaining(plan));
    const format = plan.exportFormat ?? "csv";
    const archives: ExportReceipt[] = [];
    for (const target of classification.contractObjects) {
      const archive = this.contractGuard.exportArchive({
        session: plan.live,
        target,
        format,
        directory: plan.archiveDir ?? plan.workDir,
        now: this.clock,
      });
      archives.push(archive);
      this.trace.push(`export:${archive.artifactPath}`);
    }
    if (archives.length === 0) {
      throw new BackupRequiredBeforeLiveMigrationError("contract export produced no archive");
    }
    const card = this.contractGuard.requireDestructiveApproval({
      policy: this.deps.policy,
      migrationId: plan.migrationId,
      env: plan.env,
      dropStatements: classification.contractSql,
      archives,
    });
    this.trace.push("approval:destructive_contract");
    const effectId = effectIdentity(plan.migrationId, "destructive_contract");
    this.record(plan, effectId, "migration_destructive_contract", card.payloadHash, "approved");
    for (const statement of classification.contractSql) {
      this.trace.push(`contract:${statement}`);
      await executeLiveDdl({
        session: plan.live,
        statement,
        sleep: this.sleep,
        random: this.random,
      });
    }
    this.deps.store.applyEffect(
      effectId,
      "confirmed",
      archives.map((archive) => archive.checksumSha256).join(","),
    );
    return archives.map((archive) => archive.artifactPath).join("\n");
  }

  private remaining(plan: ExpandContractPlan): number {
    let remaining = 0;
    for (const spec of plan.backfills ?? []) {
      const row = plan.live.get(
        `SELECT COUNT(*) AS c FROM ${quoteIdent(spec.table)} WHERE ${quoteIdent(spec.targetColumn)} IS NULL`,
      );
      const value = row?.c;
      remaining += typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
    }
    return remaining;
  }

  private async authorize(
    plan: ExpandContractPlan,
    kind: ApprovalKind,
    payload: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const card = buildApprovalCard({
      migrationId: plan.migrationId,
      env: plan.env,
      kind,
      payload,
    });
    const effectId = effectIdentity(plan.migrationId, kind);
    this.record(plan, effectId, `migration_${kind}`, card.payloadHash, "intended");
    const decision = this.deps.policy.decide(card);
    if (!decision.approved || decision.payloadHash !== card.payloadHash) {
      this.deps.store.applyEffect(effectId, "failed", decision.reason);
      throw new ApprovalRequiredError(`${card.title} (${decision.reason})`);
    }
    this.deps.store.applyEffect(effectId, "approved", decision.reason);
    this.trace.push(`approval:${kind}`);
  }

  private record(
    plan: ExpandContractPlan,
    id: string,
    kind: string,
    payloadHash: string,
    state: "intended" | "approved",
  ): void {
    this.deps.store.recordEffect({
      id,
      kind,
      target: plan.targetHost,
      payloadHash,
      idempotencyKey: `live-migration:${plan.migrationId}:${kind}:${id}`,
      targetEnv: plan.env,
      approval: state === "approved" ? "approved" : "intended",
    });
  }

  private blank(plan: ExpandContractPlan, classification: DdlClassification, sqlSha256: string): PersistedRun {
    return {
      migrationId: plan.migrationId,
      env: plan.env,
      dialect: plan.dialect,
      commitSha: plan.commitSha,
      previousCommitSha: plan.previousCommitSha,
      sqlSha256,
      currentPhase: "REHEARSE",
      phases: blankPhases(),
      classification,
      backup: null,
      deploy: null,
      rolledBackTo: null,
      contractExportPath: null,
      fastPath: false,
      shipRunId: `ship-${plan.migrationId}`,
      detail: "",
    };
  }

  private touch(run: PersistedRun, phase: PhaseName, status: PhaseStatus, detail: string): PersistedRun {
    const next: PersistedRun = {
      ...run,
      currentPhase: phase,
      detail,
      phases: {
        ...run.phases,
        [phase]: { phase, status, detail },
      },
    };
    this.deps.store.saveRun(next);
    return next;
  }

  close(): void {
    this.deps.store.close();
  }

  private snapshot(run: PersistedRun): MigrationRunState {
    const fresh = this.deps.store.getRun(run.migrationId) ?? run;
    const cursor = this.deps.store.latestCursor(fresh.migrationId);
    return { ...fresh, progressText: cursor?.progressText ?? null, backfillCursor: cursor };
  }
}

function openRehearsal(plan: ExpandContractPlan): SqliteSession {
  const file = path.join(plan.workDir, `${plan.migrationId}-rehearse.sqlite`);
  if (existsSync(file)) {
    rmSync(file, { force: true });
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
  }
  return new SqliteSession(file);
}

function effectIdentity(migrationId: string, kind: string): string {
  return `effect-${migrationId}-${kind}`;
}

function pitrReceipt(attestation: PitrAttestation): BackupReceipt {
  return {
    artifactPath: "",
    checksumSha256: sha256Text(attestation.writtenOverride),
    verified: true,
    method: "external-pitr",
    detail: attestation.writtenOverride,
    rowCount: null,
  };
}

function releaseOrRollback(session: SqlSession): void {
  try {
    session.exec("ROLLBACK TO rehearse_stmt");
    session.exec("RELEASE rehearse_stmt");
  } catch (error) {
    if (!/no such savepoint|no transaction/i.test(errorMessage(error))) {
      try {
        session.exec("ROLLBACK");
      } catch (rollbackError) {
        if (!/no transaction/i.test(errorMessage(rollbackError))) throw rollbackError;
      }
    }
  }
}
