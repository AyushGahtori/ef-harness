import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createCompletenessGateRunner } from "@ef-harness/completeness-gate";
import { CasBlobStore } from "@ef-harness/db";
import { BrandAssetRegistry, brandAssets } from "@ef-harness/intake";
import { AdvisoryTasteVisionReviewer, DesignTokenLintRuleset } from "@ef-harness/planner";
import type { BeforeAfterBaselinePort, BrandAssetRegistryPort, CasStorePort, DesignTokenLintPort, StaticAuditGatePort, TasteReviewerPort } from "./ports.js";
import type { CasArtifactRecord, RasterFrame, RepoFileSlice, UiConsistencyFinding } from "./types.js";

const GLOBAL_SCHEMA = fileURLToPath(new URL("../../../../schema/global.sql", import.meta.url));

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function located(file: string, line: number, rule: string, message: string): UiConsistencyFinding {
  return {
    stage: "token_discipline",
    rule,
    severity: "error",
    message,
    location: { file, line, dataEfSource: `${file}:${line}` },
  };
}

export class LandedCasStore implements CasStorePort {
  private readonly records = new Map<string, CasArtifactRecord>();
  private readonly pending: Promise<unknown>[] = [];

  constructor(private readonly blobs: CasBlobStore) {}

  put(record: CasArtifactRecord): string {
    const bytes = Buffer.from(record.frame.pixels.buffer, record.frame.pixels.byteOffset, record.frame.pixels.byteLength);
    return this.putBytes(bytes, record);
  }

  putBytes(bytes: Uint8Array, record?: CasArtifactRecord): string {
    const id = record?.id && record.id.startsWith("sha256:") ? record.id : digest(bytes);
    if (record) this.records.set(id, { ...record, id });
    this.pending.push(
      this.blobs.put(bytes, {
        holderKind: "project",
        holderId: "ui-consistency",
        format: "raw",
      }),
    );
    return id;
  }

  get(id: string): CasArtifactRecord | null {
    return this.records.get(id) ?? null;
  }

  flush(): Promise<void> {
    return Promise.all(this.pending).then(() => undefined);
  }
}

export async function openLandedCas(): Promise<{ readonly store: LandedCasStore; readonly close: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "ef-ui-cas-"));
  const globalDb = new DatabaseSync(":memory:");
  globalDb.exec("PRAGMA foreign_keys = ON");
  globalDb.exec(readFileSync(GLOBAL_SCHEMA, "utf8"));
    const blobs = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
  const store = new LandedCasStore(blobs);
  return {
    store,
    close: async () => {
      await store.flush();
      globalDb.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export class LandedStaticAuditGate implements StaticAuditGatePort {
  readonly source = "@ef-harness/completeness-gate:CompletenessGateRunner";
  private readonly runner = createCompletenessGateRunner();

  scanFiles(files: readonly RepoFileSlice[]): UiConsistencyFinding[] {
    const report = this.runner.runLeafStaticAudit({
      taskId: "ui-consistency",
      featureId: "ui-consistency",
      actor: "worker",
      baseRef: "base",
      candidateRef: "candidate",
      files: files.map((file) => ({ path: file.path, status: "added" as const, beforeText: "", afterText: file.contents })),
      produces: [],
      schemaFields: [],
      staticData: [],
      approvedDeferralIds: [],
      excludedGeneratedPaths: [],
      seedFixturePaths: [],
      protectedTestPaths: ["tests/**", "**/*.test.ts"],
      protectedTestConfigPaths: ["vitest.config.ts"],
      lockedSnapshotPaths: ["**/*.snap"],
      verificationScopeGrant: false,
      writeScope: ["**"],
      integratorConflictHunks: [],
      declaredSharedFiles: [],
      errorHandlingRequiresSurface: false,
      entryPoints: [],
      registeredAssets: [],
      publicFiles: [],
      assetModuleSources: [],
      visibleExampleLiterals: [],
      deletionDeclared: false,
      justifiedTaskNotes: [],
      registry: { names: [] },
      vaultSecrets: [],
    });
    return report.findings.map((finding) => ({
      stage: "token_discipline" as const,
      rule: finding.ruleId,
      severity: "warning" as const,
      message: finding.message,
      location: { file: finding.file, line: finding.line, dataEfSource: `${finding.file}:${finding.line}` },
    }));
  }
}

export class LandedDesignTokenLint implements DesignTokenLintPort {
  readonly source = "@ef-harness/planner:DesignTokenLintRuleset";
  private readonly rules = new DesignTokenLintRuleset();

  lintFiles(files: readonly RepoFileSlice[]): UiConsistencyFinding[] {
    const findings: UiConsistencyFinding[] = [];
    for (const file of files) {
      for (const violation of this.rules.lintFile(file.path, file.contents)) {
        findings.push(located(file.path, violation.line, violation.rule, violation.message));
      }
    }
    return findings;
  }
}

export class LandedBrandAssetRegistry implements BrandAssetRegistryPort {
  readonly source = "@ef-harness/intake:BrandAssetRegistry";
  private readonly registry: BrandAssetRegistry;

  constructor() {
    const bytes = new Map<string, Uint8Array>();
    this.registry = new BrandAssetRegistry({
      cas: {
        source: brandAssets.CAS_BLOB_STORE_SOURCE,
        putBlob(payload) {
          const hash = digest(payload);
          bytes.set(hash, payload);
          return { hash, bytes: payload.byteLength, deduplicated: false };
        },
        getBlob(hash) {
          return bytes.get(hash) ?? new Uint8Array();
        },
        verifyBlobIntegrity() {
          return;
        },
        pinBlob() {
          return;
        },
        unpinHolder() {
          return undefined;
        },
      },
      state: {
        upsert() {
          return undefined;
        },
        list() {
          return [];
        },
        getByRole() {
          return null;
        },
      },
    });
  }

  scanHotlinks(files: readonly RepoFileSlice[]): UiConsistencyFinding[] {
    void this.registry.alerts;
    const findings: UiConsistencyFinding[] = [];
    for (const file of files) {
      for (const hit of brandAssets.scanUnapprovedHotlinks(file.contents)) {
        findings.push(located(file.path, hit.line, "ef/no-external-hotlink", hit.message));
      }
    }
    return findings;
  }
}

export class LandedBeforeAfterBaseline implements BeforeAfterBaselinePort {
  readonly source = "cas-blob-store:BeforeAfterBaselineApprover";
  private readonly frames = new Map<string, RasterFrame>();

  present(input: { readonly route: string; readonly viewportId: string; readonly theme: string; readonly frame: RasterFrame }): void {
    this.frames.set(this.key(input), input.frame);
  }

  approveAndUpdateBaseline(input: { readonly route: string; readonly viewportId: string; readonly theme: string }): RasterFrame | null {
    return this.frames.get(this.key(input)) ?? null;
  }

  resolveApprovedBaseline(input: { route: string; viewportId: string; theme: string }): RasterFrame | null {
    return this.frames.get(this.key(input)) ?? null;
  }

  private key(input: { readonly route: string; readonly viewportId: string; readonly theme: string }): string {
    return `${input.route}@${input.viewportId}@${input.theme}`;
  }
}

export class LandedTasteReviewer implements TasteReviewerPort {
  readonly source = "@ef-harness/planner:AdvisoryTasteVisionReviewer";
  private readonly reviewer = new AdvisoryTasteVisionReviewer({ model: null });

  async reviewScreenshots(input: {
    casArtifactIds: readonly string[];
    budgetOk: boolean;
  }): Promise<{ status: "advisory_sent" | "skipped_no_budget" | "skipped_no_vision_model" }> {
    if (!input.budgetOk) return { status: "skipped_no_budget" };
    if (input.casArtifactIds.length === 0) return { status: "skipped_no_vision_model" };
    const safe = new TextEncoder().encode("synthetic seeded frame");
    const result = await this.reviewer.review({
      taskId: "ui-consistency",
      stage: "Production",
      preset: "Balanced",
      budgetLimitUnits: 100,
      budgetSpentUnits: 0,
      screenshots: input.casArtifactIds.map((id) => ({
        id,
        screenId: "ui",
        kind: "full_page" as const,
        viewportWidth: 1440,
        bytes: safe,
        environment: "synthetic_test_env" as const,
        seeded: true,
        seedReceiptId: id,
        sourceFiles: ["src/features/orders/components/OrdersPage.tsx"],
      })),
      roster: [{ family: "vision", vision: true, level: "Mid" }],
      workerFamily: "vision",
      knownFiles: ["src/features/orders/components/OrdersPage.tsx"],
      knownNodeIds: [],
      knownReceiptIds: input.casArtifactIds,
    });
    if (result.status === "advisory") return { status: "advisory_sent" };
    if (result.reason === "skipped_budget_pressure") return { status: "skipped_no_budget" };
    return { status: "skipped_no_vision_model" };
  }
}

export const defaultConsumedPorts = {
  staticAudit: new LandedStaticAuditGate(),
  tokenLint: new LandedDesignTokenLint(),
  brandAssets: new LandedBrandAssetRegistry(),
  baseline: new LandedBeforeAfterBaseline(),
  taste: new LandedTasteReviewer(),
} as const;
