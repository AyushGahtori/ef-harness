import { describe, expect, it } from "vitest";
import {
  AttemptNotArchivableError,
  AssetRemovalError,
  DIAGNOSTIC_RETENTION_MS,
  EPHEMERAL_RETENTION_MS,
  loadCanonicalQueries,
  runCanonicalArchiveInsert,
  runCanonicalPurge,
} from "../../src/artifacts/index.js";
import { countPins, openFixture, retentionOf } from "./fixture.js";

const DAY = 24 * 60 * 60 * 1000;

describe("retention, scrub, and turn_log archival", () => {
  it("expires retention classes and evicts oldest diagnostic pins before expired ephemeral", () => {
    const fx = openFixture();
    const now = fx.clock;
    try {
      fx.seedAttempt("A-old", "accepted", now - 20 * DAY);
      fx.seedAttempt("A-fresh", "rejected", now - DAY);
      fx.seedAttempt("A-keep", "accepted", now - DIAGNOSTIC_RETENTION_MS + 1);
      fx.clock = now - DIAGNOSTIC_RETENTION_MS;
      const expiredDiagnostic = fx.manager.storeArtifact({
        content: "expired diagnostic",
        kind: "log",
        retention: "diagnostic",
        owners: [{ ownerKind: "attempt", ownerId: "A-old" }],
      });
      const orphan = fx.manager.storeArtifact({
        content: "orphan diagnostic",
        kind: "log",
        retention: "diagnostic",
      });
      fx.clock = now - EPHEMERAL_RETENTION_MS;
      const expiredEphemeral = fx.manager.storeArtifact({
        content: "expired ephemeral",
        kind: "log",
        retention: "ephemeral",
      });
      fx.clock = now - 3_000;
      const oldest = fx.manager.storeArtifact({
        content: "diag oldest",
        kind: "log",
        retention: "diagnostic",
        owners: [{ ownerKind: "attempt", ownerId: "A-fresh" }],
      });
      fx.clock = now - 2_000;
      const middle = fx.manager.storeArtifact({
        content: "diag middle",
        kind: "log",
        retention: "diagnostic",
        owners: [{ ownerKind: "attempt", ownerId: "A-fresh" }],
      });
      fx.clock = now - 1_000;
      const newest = fx.manager.storeArtifact({
        content: "diag newest",
        kind: "log",
        retention: "diagnostic",
        owners: [{ ownerKind: "attempt", ownerId: "A-fresh" }],
      });
      const boundaryKeep = fx.manager.storeArtifact({
        content: "diag boundary keep",
        kind: "log",
        retention: "diagnostic",
        owners: [{ ownerKind: "attempt", ownerId: "A-keep" }],
      });
      fx.clock = now;
      const evidence = fx.manager.storeArtifact({
        content: "evidence log",
        kind: "log",
        retention: "evidence",
      });
      const asset = fx.manager.storeArtifact({
        content: "brand asset",
        kind: "asset",
        retention: "asset",
      });
      const freshEphemeral = fx.manager.storeArtifact({
        content: "fresh ephemeral",
        kind: "log",
        retention: "ephemeral",
      });
      fx.manager.storeResearchDocument({
        packageName: "example-lib",
        versionRange: "15.4",
        docUrl: "https://example.test/old",
        content: "old minor docs",
        fetchedAt: now,
        expiresAt: now + 10 * DAY,
      });
      const liveResearch = fx.manager.storeResearchDocument({
        packageName: "example-lib",
        versionRange: "15.5",
        docUrl: "https://example.test/current",
        content: "current docs",
        fetchedAt: now,
        expiresAt: now + 10 * DAY,
      });
      const staleTtl = fx.manager.storeResearchDocument({
        packageName: "other-lib",
        versionRange: "1.2",
        docUrl: "https://example.test/ttl",
        content: "ttl docs",
        fetchedAt: now - DAY,
        expiresAt: now - 1,
      });

      const timeReport = fx.manager.enforceRetentionAndStorageCap({
        now,
        storageCapBytes: 50 * 1024 * 1024 * 1024,
        currentPackageVersions: { "example-lib": "15.5" },
      });
      expect(timeReport.warning).toBeNull();
      expect(retentionOf(fx.state, expiredDiagnostic.artifactId)).toBeNull();
      expect(retentionOf(fx.state, orphan.artifactId)).toBeNull();
      expect(retentionOf(fx.state, expiredEphemeral.artifactId)).toBeNull();
      expect(retentionOf(fx.state, newest.artifactId)).toBe("diagnostic");
      expect(retentionOf(fx.state, boundaryKeep.artifactId)).toBe("diagnostic");
      expect(retentionOf(fx.state, evidence.artifactId)).toBe("evidence");
      expect(retentionOf(fx.state, asset.artifactId)).toBe("asset");
      expect(retentionOf(fx.state, freshEphemeral.artifactId)).toBe("ephemeral");
      expect(countPins(fx.globalDb, evidence.hash)).toBe(1);
      expect(countPins(fx.globalDb, asset.hash)).toBe(1);
      expect(countPins(fx.globalDb, staleTtl.hash)).toBe(0);
      expect(countPins(fx.globalDb, liveResearch.hash)).toBe(1);
      expect(
        fx.globalDb.prepare("SELECT count(*) AS c FROM research_cache WHERE doc_url = ?").get("https://example.test/old")
          ?.c,
      ).toBe(0);

      const cap =
        bytesOf(fx, newest.hash) +
        bytesOf(fx, boundaryKeep.hash) +
        bytesOf(fx, freshEphemeral.hash) +
        bytesOf(fx, evidence.hash) +
        bytesOf(fx, asset.hash) +
        bytesOf(fx, liveResearch.hash);
      const capReport = fx.manager.enforceRetentionAndStorageCap({
        now,
        storageCapBytes: cap,
        currentPackageVersions: { "example-lib": "15.5" },
      });
      const capDiagnostics = capReport.evictions.filter((row) => row.reason === "storage_cap");
      expect(capDiagnostics.map((row) => row.artifactId)).toEqual([oldest.artifactId, middle.artifactId]);
      expect(capReport.evictions.some((row) => row.artifactId === evidence.artifactId)).toBe(false);
      expect(capReport.evictions.some((row) => row.artifactId === asset.artifactId)).toBe(false);
      expect(retentionOf(fx.state, newest.artifactId)).toBe("diagnostic");
      expect(retentionOf(fx.state, freshEphemeral.artifactId)).toBe("ephemeral");
      expect(countPins(fx.globalDb, evidence.hash)).toBe(1);
      expect(countPins(fx.globalDb, asset.hash)).toBe(1);
      expect(countPins(fx.globalDb, oldest.hash)).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("warns instead of deleting evidence and asset when they alone exceed the cap", () => {
    const fx = openFixture();
    try {
      const evidence = fx.manager.storeArtifact({
        content: "keep evidence",
        kind: "log",
        retention: "evidence",
      });
      const asset = fx.manager.storeArtifact({
        content: "keep asset",
        kind: "source",
        retention: "asset",
      });
      const fresh = fx.manager.storeArtifact({
        content: "fresh command output",
        kind: "log",
        retention: "ephemeral",
      });
      const report = fx.manager.enforceRetentionAndStorageCap({ storageCapBytes: 1 });
      expect(report.evictions).toEqual([]);
      expect(report.warning?.code).toBe("StorageCapExceeded");
      expect(report.warning?.severity).toBe("high");
      expect(report.warning?.message).toContain("Settings → Storage");
      expect(countPins(fx.globalDb, evidence.hash)).toBe(1);
      expect(countPins(fx.globalDb, asset.hash)).toBe(1);
      expect(countPins(fx.globalDb, fresh.hash)).toBe(1);
      expect(fx.logs.some((event) => event.code === "StorageCapExceeded")).toBe(true);
      fx.manager.removeDeveloperAsset(asset.artifactId);
      expect(retentionOf(fx.state, asset.artifactId)).toBeNull();
      expect(countPins(fx.globalDb, asset.hash)).toBe(0);
      expect(() => fx.manager.removeDeveloperAsset(evidence.artifactId)).toThrow(AssetRemovalError);
    } finally {
      fx.close();
    }
  });

  it("scrubs a rotating sample of non-evidence blobs and quarantines corruption", () => {
    const fx = openFixture();
    try {
      const evidence = fx.manager.storeArtifact({
        content: "evidence bytes",
        kind: "log",
        retention: "evidence",
      });
      const good = fx.manager.storeArtifact({
        content: "good diagnostic",
        kind: "log",
        retention: "diagnostic",
      });
      const bad = fx.manager.storeArtifact({
        content: "bad diagnostic",
        kind: "log",
        retention: "diagnostic",
      });
      fx.cas.tamper(evidence.hash);
      fx.cas.tamper(bad.hash);
      const report = fx.manager.runWeeklyIntegrityScrub({ sampleSize: 20 });
      expect(report.checked).not.toContain(evidence.hash);
      expect(report.checked).toContain(good.hash);
      expect(report.checked).toContain(bad.hash);
      expect(report.verified).toContain(good.hash);
      expect(report.quarantined).toContain(bad.hash);
      expect(report.quarantined).not.toContain(evidence.hash);
      expect(report.regenerationRequired.map((flag) => flag.artifactId)).toContain(bad.artifactId);
      const badState = fx.globalDb.prepare("SELECT state FROM cas_blobs WHERE hash = ?").get(bad.hash);
      const evidenceState = fx.globalDb.prepare("SELECT state FROM cas_blobs WHERE hash = ?").get(evidence.hash);
      const goodVerified = fx.globalDb
        .prepare("SELECT last_verified_at FROM cas_blobs WHERE hash = ?")
        .get(good.hash);
      expect(badState?.state).toBe("quarantined");
      expect(evidenceState?.state).toBe("ok");
      expect(typeof goodVerified?.last_verified_at).toBe("number");

      const first = fx.manager.storeArtifact({ content: "rotate-a", kind: "log", retention: "diagnostic" });
      const second = fx.manager.storeArtifact({ content: "rotate-b", kind: "log", retention: "diagnostic" });
      const pass1 = fx.manager.runWeeklyIntegrityScrub({ sampleSize: 1 });
      const pass2 = fx.manager.runWeeklyIntegrityScrub({ sampleSize: 1 });
      const rotated = [pass1.checked[0], pass2.checked[0]];
      expect(rotated).toContain(first.hash);
      expect(rotated).toContain(second.hash);
      expect(pass1.checked[0]).not.toBe(evidence.hash);
    } finally {
      fx.close();
    }
  });

  it("archives terminal attempts and refuses to purge running, submitted, and parked turn logs", () => {
    const queries = loadCanonicalQueries();
    expect(queries.archiveTurnLog).toContain("HAVING count(*) > 0");
    expect(queries.purgeArchivedTurnLog).toContain("NOT IN ('running','submitted','parked')");

    const fx = openFixture();
    try {
      fx.seedAttempt("A-live", "running", null);
      fx.state
        .prepare(
          "INSERT INTO turn_log(attempt, step, tool_call, tokens_in, tokens_out) VALUES ('A-live', 1, 'read', 10, 5), ('A-live', 2, 'edit', 20, 7)",
        )
        .run();
      const placeholder = fx.manager.storeArtifact({
        content: "placeholder",
        kind: "items",
        retention: "evidence",
      });
      expect(runCanonicalArchiveInsert(fx.state, queries, "A-live", placeholder.artifactId, 10)).toBe(1);
      expect(runCanonicalPurge(fx.state, queries, "A-live")).toBe(0);
      expect(turnCount(fx, "A-live")).toBe(2);
      fx.state.prepare("UPDATE attempts SET state = 'submitted' WHERE id = 'A-live'").run();
      expect(runCanonicalPurge(fx.state, queries, "A-live")).toBe(0);
      fx.state.prepare("UPDATE attempts SET state = 'parked' WHERE id = 'A-live'").run();
      expect(runCanonicalPurge(fx.state, queries, "A-live")).toBe(0);
      expect(turnCount(fx, "A-live")).toBe(2);
      expect(() => fx.manager.archiveClosedAttemptTurnLog("A-live")).toThrow(AttemptNotArchivableError);
      expect(turnCount(fx, "A-live")).toBe(2);

      fx.seedAttempt("A-done", "parked", fx.clock);
      fx.state
        .prepare(
          `INSERT INTO turn_log(attempt, step, tool_call, tokens_in, tokens_out)
           VALUES ('A-done', 1, 'read', 10, 5), ('A-done', 2, 'edit', NULL, 7), ('A-done', 3, 'test', 20, 3)`,
        )
        .run();
      expect(() => fx.manager.archiveClosedAttemptTurnLog("A-done")).toThrow(AttemptNotArchivableError);
      fx.state.prepare("UPDATE attempts SET state = 'running' WHERE id = 'A-done'").run();
      expect(() => fx.manager.archiveClosedAttemptTurnLog("A-done")).toThrow(AttemptNotArchivableError);
      expect(turnCount(fx, "A-done")).toBe(3);
      fx.state.prepare("UPDATE attempts SET state = 'accepted' WHERE id = 'A-done'").run();
      const archived = fx.manager.archiveClosedAttemptTurnLog("A-done");
      expect(archived.status).toBe("archived");
      expect(archived.steps).toBe(3);
      expect(archived.tokensIn).toBe(30);
      expect(archived.tokensOut).toBe(15);
      expect(turnCount(fx, "A-done")).toBe(0);
      expect(retentionOf(fx.state, archived.artifactId ?? "")).toBe("evidence");
      const replay = fx.manager.readLogRange(archived.artifactId ?? "", 1, 5);
      expect(replay.lines).toHaveLength(3);
      expect(JSON.parse(replay.lines[0] ?? "{}")).toMatchObject({ step: 1, tokens_in: 10, tokens_out: 5 });
      expect(JSON.parse(replay.lines[1] ?? "{}")).toMatchObject({ step: 2, tokens_in: null, tokens_out: 7 });
      const again = fx.manager.archiveClosedAttemptTurnLog("A-done");
      expect(again.status).toBe("already_archived");
      expect(again.artifactId).toBe(archived.artifactId);
      expect(
        fx.state.prepare("SELECT count(*) AS c FROM turn_log_archives WHERE attempt = 'A-done'").get()?.c,
      ).toBe(1);

      fx.seedAttempt("A-empty", "rejected", fx.clock);
      const empty = fx.manager.archiveClosedAttemptTurnLog("A-empty");
      expect(empty.status).toBe("empty");
      expect(empty.artifactId).toBeNull();
      expect(fx.state.prepare("SELECT count(*) AS c FROM turn_log_archives WHERE attempt = 'A-empty'").get()?.c).toBe(
        0,
      );
      expect(fx.manager.archiveClosedAttemptTurnLog("A-empty").status).toBe("empty");

      for (const state of ["fenced", "crashed"] as const) {
        const id = `A-${state}`;
        fx.seedAttempt(id, state, fx.clock);
        fx.state
          .prepare("INSERT INTO turn_log(attempt, step, tool_call, tokens_in, tokens_out) VALUES (?, 1, 'x', 4, 6)")
          .run(id);
        const result = fx.manager.archiveClosedAttemptTurnLog(id);
        expect(result.status).toBe("archived");
        expect(result.tokensIn).toBe(4);
        expect(result.tokensOut).toBe(6);
        expect(retentionOf(fx.state, result.artifactId ?? "")).toBe("diagnostic");
        expect(turnCount(fx, id)).toBe(0);
      }
    } finally {
      fx.close();
    }
  });

  it("promotes receipt-cited artifacts to evidence before diagnostic expiry", () => {
    const fx = openFixture();
    const now = fx.clock;
    try {
      fx.seedAttempt("A-accept", "accepted", now - 30 * DAY);
      fx.clock = now - 30 * DAY;
      const cited = fx.manager.storeArtifact({
        content: "cited log",
        kind: "log",
        retention: "diagnostic",
        owners: [{ ownerKind: "attempt", ownerId: "A-accept" }],
      });
      const other = fx.manager.storeArtifact({
        content: "uncited log",
        kind: "log",
        retention: "diagnostic",
        owners: [{ ownerKind: "attempt", ownerId: "A-accept" }],
      });
      fx.state.prepare("DELETE FROM artifact_refs WHERE artifact = ?").run(other.artifactId);
      const promoted = fx.manager.promoteAttemptEvidence("A-accept");
      expect(promoted.artifactIds).toContain(cited.artifactId);
      expect(retentionOf(fx.state, cited.artifactId)).toBe("evidence");
      expect(retentionOf(fx.state, other.artifactId)).toBe("diagnostic");
      fx.manager.enforceRetentionAndStorageCap({ now, storageCapBytes: 50 * 1024 * 1024 * 1024 });
      expect(retentionOf(fx.state, cited.artifactId)).toBe("evidence");
      expect(countPins(fx.globalDb, cited.hash)).toBe(1);
      expect(retentionOf(fx.state, other.artifactId)).toBeNull();
    } finally {
      fx.close();
    }
  });
});

function bytesOf(fx: { globalDb: { prepare(sql: string): { get(hash: string): { stored_bytes?: unknown } | undefined } } }, hash: string): number {
  const row = fx.globalDb.prepare("SELECT stored_bytes FROM cas_blobs WHERE hash = ?").get(hash);
  const value = row?.stored_bytes;
  return typeof value === "number" ? value : Number(value ?? 0);
}

function turnCount(fx: { state: { prepare(sql: string): { get(id: string): { c?: unknown } | undefined } } }, id: string): number {
  const row = fx.state.prepare("SELECT count(*) AS c FROM turn_log WHERE attempt = ?").get(id);
  const value = row?.c;
  return typeof value === "number" ? value : Number(value ?? 0);
}
