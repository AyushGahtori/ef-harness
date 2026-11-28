import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PayloadHashMismatchError,
  bindMigrationState,
  ciLoop,
  deployAdapters,
  effects,
  github,
  liveMigrations,
  openShipStateFile,
  postDeploy,
  shipDeployModules,
} from "../../src/index.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ship-deploy C71 wire", () => {
  it("exports the six ship-deploy modules", () => {
    expect([...shipDeployModules]).toEqual([
      "effects",
      "github",
      "ci-loop",
      "deploy-adapters",
      "live-migrations",
      "post-deploy",
    ]);
    expect(effects.ExternalEffectLedger).toBeTypeOf("function");
    expect(github.GitHubRateAwareQueue).toBeTypeOf("function");
    expect(ciLoop.SqliteShipRunStore).toBeTypeOf("function");
    expect(deployAdapters.DockerOverSshDeployAdapter).toBeTypeOf("function");
    expect(liveMigrations.ExpandContractMigrationOrchestrator).toBeTypeOf("function");
    expect(postDeploy.PostDeployVerifier).toBeTypeOf("function");
    expect(postDeploy.createPostDeployCleanVerifier().parseCollectedCaseIds("").format).toBe("empty");
  });

  it("rejects a reused migration idempotency key when the payload hash changes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-mig-hash-"));
    directories.push(root);
    const store = bindMigrationState(path.join(root, "state.db"));
    const shared = {
      id: "effect-mig-1",
      kind: "migration_expand",
      target: "orders",
      idempotencyKey: "live-migration:mig-1:expand",
      targetEnv: "production" as const,
      approval: "intended" as const,
    };
    store.recordEffect({ ...shared, payloadHash: "a".repeat(64) });
    expect(() => store.recordEffect({ ...shared, payloadHash: "b".repeat(64) })).toThrow(
      PayloadHashMismatchError,
    );
    store.close();
  });

  it("persists a post-deploy receipt in ship_runs and a smoke blob in CAS", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-post-deploy-"));
    directories.push(root);
    const db = openShipStateFile(path.join(root, "state.db"));
    const store = new postDeploy.SqlitePostDeployStore(db);
    store.saveShipRun({
      id: "ship-1",
      kind: "deploy",
      environment: "staging",
      headSha: "abc123",
      deploymentId: "dep-1",
      url: "https://staging.example.test",
      state: "SHIPPED",
      schemaStatus: "passed",
      failureFingerprint: null,
      updatedAt: 10,
      receipt: {
        shipRunId: "ship-1",
        env: "staging",
        commitSha: "abc123",
        liveUrl: "https://staging.example.test",
        deploymentId: "dep-1",
        healthPassedAt: "2026-01-01T00:00:00.000Z",
        smokeReceiptSha: "c".repeat(64),
        tenMinWatchVerdict: "clean",
        registrations: [],
        rollbackTargetId: null,
        state: "SHIPPED",
      },
    });
    db.close();
    const reopened = openShipStateFile(path.join(root, "state.db"));
    const again = new postDeploy.SqlitePostDeployStore(reopened);
    expect(again.getShipRun("ship-1")?.state).toBe("SHIPPED");
    expect(again.getShipRun("ship-1")?.schemaStatus).toBe("passed");
    const cas = await postDeploy.openPostDeployCas({
      rootDir: path.join(root, "cas"),
      holderId: "ship-1",
    });
    const stored = await cas.cas.put({ kind: "screenshot", text: "smoke ok" });
    expect(stored.hash).toMatch(/^[a-f0-9]{64}$/);
    cas.close();
    reopened.close();
  });
});
