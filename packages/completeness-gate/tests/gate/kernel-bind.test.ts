import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNameRegistryService, openMemoryStateDb } from "@ef-harness/db";
import { GitSafetyScanner } from "@ef-harness/git-engine";
import { bindGitSafetyScanner, bindNameRegistryService } from "../../src/gate/index.js";

const open: ReturnType<typeof openMemoryStateDb>[] = [];

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

describe("kernel binds", () => {
  it("calls NameRegistryService.auditCodeNamesAgainstRegistry and returns gate failures", () => {
    const db = openMemoryStateDb();
    open.push(db);
    const service = createNameRegistryService(db);
    service.allocateFeaturePrefix({ kind: "env_var", prefix: "APP_", feature: "F12" });
    service.allocateFeaturePrefix({ kind: "env_var", prefix: "BILL_", feature: "F13" });
    service.publishNode({
      id: "T02",
      nodeKind: "task",
      title: "Kitchen",
      feature: "F12",
      names: [{ kind: "env_var", value: "APP_MODE" }],
    });
    service.publishNode({
      id: "T13",
      nodeKind: "task",
      title: "Billing",
      feature: "F13",
      names: [{ kind: "env_var", value: "BILL_MODE" }],
    });
    const registry = bindNameRegistryService(service);
    expect(
      registry.auditCodeNamesAgainstRegistry(
        [{ kind: "env_var", value: "APP_MODE", file: "src/kitchen/env.ts", line: 2 }],
        "F12",
      ),
    ).toEqual([]);
    expect(
      registry.auditCodeNamesAgainstRegistry(
        [{ kind: "env_var", value: "APP_MISSING", file: "src/kitchen/env.ts", line: 4 }],
        "F12",
      ),
    ).toEqual([
      {
        kind: "env_var",
        value: "APP_MISSING",
        reason: "unregistered",
        file: "src/kitchen/env.ts",
        line: 4,
        owner: null,
      },
    ]);
    expect(
      registry.auditCodeNamesAgainstRegistry(
        [{ kind: "env_var", value: "BILL_MODE", file: "src/kitchen/env.ts", line: 6 }],
        "F12",
      ),
    ).toEqual([
      expect.objectContaining({
        reason: "foreign_owned",
        file: "src/kitchen/env.ts",
        line: 6,
        owner: "F13",
      }),
    ]);
  });

  it("calls GitSafetyScanner.scanCommitDiffForSecrets(base, candidate)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ef-gate-safety-"));
    const secret = ["vault", "-synthetic-", "value-0001"].join("");
    try {
      git(root, ["init", "-b", "main"]);
      writeFileSync(join(root, "README.md"), "hello\n");
      git(root, ["add", "README.md"]);
      git(root, ["commit", "-m", "base"]);
      const base = git(root, ["rev-parse", "HEAD"]).trim();
      writeFileSync(join(root, "src-secret.txt"), `token=${secret}\n`);
      git(root, ["add", "src-secret.txt"]);
      git(root, ["commit", "-m", "candidate"]);
      const candidate = git(root, ["rev-parse", "HEAD"]).trim();
      const scanner = new GitSafetyScanner({
        root,
        vaultSecrets: [{ label: "canary", value: secret }],
      });
      const report = await bindGitSafetyScanner(scanner).scanCommitDiffForSecrets(base, candidate);
      expect(report.safeToCommit).toBe(false);
      expect(report.blockedSecrets.some((hit) => hit.file === "src-secret.txt")).toBe(true);
      expect(JSON.stringify(report).includes(secret)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=EF Harness", "-c", "user.email=foundation@ef-harness.local", ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "EF Harness",
        GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
        GIT_COMMITTER_NAME: "EF Harness",
        GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
      },
    },
  );
}
