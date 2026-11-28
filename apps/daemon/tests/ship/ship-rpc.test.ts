import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleIntegratedMethod, type IntegratedDaemonContext } from "../../src/server.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function context(root: string): IntegratedDaemonContext {
  return {
    profileDir: root,
    appVersion: "0.0.0",
    statePath: path.join(root, "state.db"),
    globalPath: path.join(root, "global.db"),
    telemetry() {
      throw new Error("telemetry is unused");
    },
    pauseBuild() {},
  };
}

describe("daemon ship RPCs", () => {
  it("lists the six modules, binds envDiff into the approval hash, and rejects a mismatched migration payload", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-daemon-ship-"));
    directories.push(root);
    const ctx = context(root);
    const modules = handleIntegratedMethod("ship.modules", {}, ctx);
    expect(modules).toEqual({
      handled: true,
      result: {
        modules: [
          "effects",
          "github",
          "ci-loop",
          "deploy-adapters",
          "live-migrations",
          "post-deploy",
        ],
      },
    });
    const diff = { added: [] as string[], changed: [] as string[], deleted: [] as string[], summary: "0" };
    const changed = { ...diff, added: ["RESEND_API_KEY"], summary: "1 added" };
    const first = handleIntegratedMethod(
      "ship.approvalHash",
      { targetEnv: "production", commitSha: "abc123def456", envDiff: diff },
      ctx,
    );
    const second = handleIntegratedMethod(
      "ship.approvalHash",
      { targetEnv: "production", commitSha: "abc123def456", envDiff: changed },
      ctx,
    );
    const firstHash = hashOf(first.result);
    const secondHash = hashOf(second.result);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(secondHash).not.toBe(firstHash);
    const recorded = handleIntegratedMethod(
      "ship.migrationEffect",
      {
        idempotencyKey: "mig-key",
        payloadHash: "a".repeat(64),
        targetEnv: "staging",
        kind: "migration_expand",
        target: "orders",
      },
      ctx,
    );
    expect(recorded.result).toEqual({ ok: true, rejected: false });
    const mismatch = handleIntegratedMethod(
      "ship.migrationEffect",
      {
        idempotencyKey: "mig-key",
        payloadHash: "b".repeat(64),
        targetEnv: "staging",
        kind: "migration_expand",
        target: "orders",
      },
      ctx,
    );
    expect(mismatch.result).toEqual({
      ok: false,
      rejected: true,
      code: "payload_hash_mismatch",
    });
    const parsed = handleIntegratedMethod("ship.parseSmoke", { text: "" }, ctx);
    expect(parsed.result).toEqual({ format: "empty", cases: 0 });
    const vault = handleIntegratedMethod("ship.vaultNames", { projectId: "c71" }, ctx);
    if (process.platform === "win32") {
      expect(vault.result).toMatchObject({ available: true });
    } else {
      expect(vault.result).toEqual({ available: false, names: [] });
    }
  });
});

function hashOf(result: unknown): string {
  if (!result || typeof result !== "object" || !("hash" in result)) return "";
  const hash = result.hash;
  return typeof hash === "string" ? hash : "";
}
