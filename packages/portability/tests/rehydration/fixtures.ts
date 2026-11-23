import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  computeCanonicalGraphSha256,
  serializeEntity,
  serializeLease,
  serializeManifest,
  type ExportEntity,
  type HistoryRecord,
  type LeaseDocument,
} from "../../src/rehydration/index.js";

import { encryptAgePayload } from "../../src/rehydration/age-sealed-checks-encryptor.js";

export interface HarnessFixture {
  readonly bareRepoPath: string;
  readonly laptopAPath: string;
  readonly laptopBPath: string;
  readonly deviceA: string;
  readonly deviceB: string;
  readonly ageIdentity: string;
  readonly ageRecipient: string;
}

export function runGit(args: readonly string[], cwd: string, input?: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", input, windowsHide: true });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr ?? "").trim() || (result.stdout ?? "").trim() || `exit ${result.status}`}`,
    );
  }
  return result.stdout ?? "";
}

function seedHarnessStateBranch(repoPath: string, files: Record<string, string>, message: string): string {
  runGit(["init"], repoPath);
  runGit(["config", "user.email", "foundation@ef-harness.local"], repoPath);
  runGit(["config", "user.name", "EF Harness"], repoPath);
  runGit(["checkout", "-b", "harness-state"], repoPath);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
  runGit(["add", "-A"], repoPath);
  runGit(["commit", "-m", message], repoPath);
  return runGit(["rev-parse", "harness-state"], repoPath).trim();
}

export async function createHarnessFixture(): Promise<HarnessFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-rehydrate-"));
  const bareRepoPath = path.join(root, "bare.git");
  const seedRepoPath = path.join(root, "seed");
  const laptopAPath = path.join(root, "laptop-a");
  const laptopBPath = path.join(root, "laptop-b");

  runGit(["init", "--bare", bareRepoPath]);

  const age = await import("age-encryption");
  const ageIdentity = await age.generateIdentity();
  const ageRecipient = await age.identityToRecipient(ageIdentity);

  const entities: ExportEntity[] = [
    {
      id: "D-001",
      kind: "decision",
      revision: 1,
      title: "Use harness-state",
      text: "Store knowledge on orphan branch",
      fields: { status: "accepted" },
    },
    {
      id: "F-12",
      kind: "feature",
      revision: 2,
      title: "Print dialog",
      text: "Print kitchen tickets",
      fields: { priority: "high" },
    },
    {
      id: "T-03",
      kind: "task",
      revision: 1,
      title: "Wire printer",
      text: "Connect ESC/POS",
      fields: { feature: "F-12" },
    },
  ];
  const history: HistoryRecord[] = [
    {
      changeId: "chg-001",
      entityId: "D-001",
      revision: 1,
      at: "2026-11-18T12:00:00.000Z",
      summary: "created decision",
    },
  ];
  const canonicalGraphSha256 = computeCanonicalGraphSha256(entities, history);
  const deviceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const lease: LeaseDocument = {
    deviceId: deviceA,
    holder: "Laptop-A",
    epoch: 4,
    heartbeat: "2026-11-18T12:04:00.000Z",
    revision: 14,
    buildActive: true,
  };
  const manifest = {
    schemaVersion: 1,
    projectId: "proj-cafe",
    exportedAt: "2026-11-18T12:05:00.000Z",
    canonicalGraphSha256,
    deviceId: deviceA,
    writerEpoch: 4,
  };

  const files: Record<string, string> = {
    "manifest.yaml": serializeManifest(manifest),
    "lease.yaml": serializeLease(lease),
    "history/2026-11-aaaaaaa.jsonl": `${JSON.stringify(history[0])}\n`,
  };
  for (const entity of entities) {
    files[`${entity.kind === "decision" ? "decisions" : entity.kind === "feature" ? "features" : "tasks"}/${entity.id}.yaml`] =
      serializeEntity(entity);
  }

  files["checks-sealed/F-12.age"] = await encryptAgePayload(ageRecipient, '{"check":"orders-total"}');

  fs.mkdirSync(seedRepoPath, { recursive: true });
  seedHarnessStateBranch(seedRepoPath, files, "seed harness-state");
  runGit(["remote", "add", "origin", bareRepoPath], seedRepoPath);
  runGit(["push", "-u", "origin", "harness-state"], seedRepoPath);

  runGit(["clone", "-b", "harness-state", bareRepoPath, laptopAPath]);
  runGit(["clone", "-b", "harness-state", bareRepoPath, laptopBPath]);

  const deviceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  return { bareRepoPath, laptopAPath, laptopBPath, deviceA, deviceB, ageIdentity, ageRecipient };
}