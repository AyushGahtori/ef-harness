import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ParallelFeatureBranchManager } from "../../src/feature-branches/branch-manager.js";
import { gitOk, revParse } from "../../src/feature-branches/git.js";
import { openFeatureBranchStateDb, type FeatureBranchStateDb } from "../../src/feature-branches/state-db.js";
import type { IntegrationHeadVerifier } from "../../src/feature-branches/types.js";

export interface Harness {
  readonly root: string;
  readonly repo: string;
  readonly state: FeatureBranchStateDb;
  readonly manager: ParallelFeatureBranchManager;
  close(): void;
}

export function createHarness(verifier?: IntegrationHeadVerifier): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-110-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  gitOk({ repo, args: ["init", "-b", "main"] });
  gitOk({ repo, args: ["commit", "--allow-empty", "-m", "init"] });
  const head = revParse(repo, "HEAD");
  gitOk({ repo, args: ["update-ref", "refs/heads/harness/integration", head] });
  const state = openFeatureBranchStateDb(path.join(root, "state.db"));
  const manager = new ParallelFeatureBranchManager({
    repo,
    state,
    worktreeRoot: path.join(root, "wt"),
    ...(verifier ? { verifier } : {}),
  });
  return {
    root,
    repo,
    state,
    manager,
    close() {
      manager.close();
      state.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function commitIntegration(
  repo: string,
  integrationRef: string,
  files: Readonly<Record<string, string>>,
  message: string,
): string {
  const old = revParse(repo, integrationRef);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "ef-110-int-"));
  try {
    gitOk({ repo, args: ["worktree", "add", "--detach", dest, old] });
    const paths = Object.keys(files);
    for (const relative of paths) {
      const full = path.join(dest, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const text = files[relative] ?? "";
      fs.writeFileSync(full, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    }
    gitOk({ repo: dest, args: ["add", "--", ...paths] });
    gitOk({ repo: dest, args: ["commit", "-m", message] });
    const next = revParse(dest, "HEAD");
    gitOk({ repo, args: ["update-ref", integrationRef, next, old] });
    return next;
  } finally {
    gitOk({ repo, args: ["worktree", "remove", "--force", dest] });
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

export function landFeature(repo: string, featureRef: string, integrationRef: string): string {
  const old = revParse(repo, integrationRef);
  const feature = revParse(repo, featureRef);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "ef-110-land-"));
  try {
    gitOk({ repo, args: ["worktree", "add", "--detach", dest, old] });
    gitOk({ repo: dest, args: ["merge", "--no-ff", "--no-edit", feature] });
    const next = revParse(dest, "HEAD");
    gitOk({ repo, args: ["update-ref", integrationRef, next, old] });
    return next;
  } finally {
    gitOk({ repo, args: ["worktree", "remove", "--force", dest] });
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

export function writeSyntheticLockfile(cwd: string): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  const lines = ["lockfileVersion: '9.0'", ""];
  for (const [name, range] of Object.entries(deps)) {
    lines.push(`${name}@${range}:`);
    lines.push(`  resolution: {integrity: sha512-${Buffer.from(name).toString("hex")}}`);
  }
  fs.writeFileSync(path.join(cwd, "pnpm-lock.yaml"), `${lines.join("\n")}\n`, "utf8");
}
