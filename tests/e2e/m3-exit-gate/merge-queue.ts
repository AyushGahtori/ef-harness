import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MergeBatchBisector, ProjectMergeQueue } from "@ef-harness/integrator";
import type { MergeFeatureRequest, QueuedFeature } from "@ef-harness/integrator";
import type { MergeCommitRecord, MergeReport, QueueFeature } from "./types.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "EF Harness",
  GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
  GIT_COMMITTER_NAME: "EF Harness",
  GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
};

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return (result.stdout ?? "").trim();
}

function write(root: string, relative: string, text: string): void {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, "utf8");
}

function initRepo(repo: string): void {
  git(repo, ["init", "--initial-branch=harness/integration"]);
  write(repo, "build.mjs", "console.log('build ok');\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "base"]);
  git(repo, ["branch", "main"]);
  git(repo, ["checkout", "--detach"]);
}

function addFeature(repo: string, feature: QueueFeature): void {
  const branch = `harness/f/${feature.id}`;
  git(repo, ["branch", branch, "harness/integration"]);
  const slot = fs.mkdtempSync(path.join(os.tmpdir(), "m3-feature-"));
  try {
    git(repo, ["worktree", "add", slot, branch]);
    const manifest = {
      id: feature.id,
      routes: [`/${feature.slug}`],
      shortcuts: [],
      middleware: [],
      checks: [`features/${feature.id}/journey.test.mjs`],
      sealed: [{ id: `${feature.id}-3b`, step: "3b", script: `features/${feature.id}/sealed/step-3b.test.mjs` }],
    };
    const journey = feature.regression
      ? `console.error(${JSON.stringify(`${feature.id} regression`)});\nprocess.exit(1);\n`
      : `console.log(${JSON.stringify(feature.id)});\n`;
    write(slot, `features/${feature.id}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    write(slot, `features/${feature.id}/journey.test.mjs`, journey);
    write(slot, `features/${feature.id}/sealed/step-3b.test.mjs`, "console.log('sealed');\n");
    write(slot, `src/${feature.slug}.txt`, feature.body);
    git(slot, ["add", "-A"]);
    git(slot, ["commit", "-m", `feature ${feature.id}`]);
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", slot], { cwd: repo, encoding: "utf8" });
    fs.rmSync(slot, { recursive: true, force: true });
  }
}

function requestFor(feature: QueueFeature): MergeFeatureRequest {
  return {
    featureId: feature.id,
    featureRef: `refs/heads/harness/f/${feature.id}`,
    spec: {
      id: feature.id,
      title: `${feature.id} title`,
      text: feature.body,
      contracts: [{ id: `contract-${feature.id}`, text: `${feature.id} contract` }],
    },
    snapshot: {
      tasks: [
        {
          id: feature.tasks,
          state: "MERGED_TO_FEATURE",
          briefVersion: 1,
          acceptedBriefVersion: 1,
          contracts: [{ id: `C-${feature.id}`, pin: 1, currentVersion: 1 }],
        },
      ],
      requirements: [{ id: feature.requirements, kind: "spec_item", status: "passing" }],
      scopes: [`features/${feature.id}/`],
      checks: [
        { id: `S-${feature.id}`, gate: "static_audit", version: 1, status: "pass" },
        { id: `J-${feature.id}`, gate: "feature_journey", version: 1, status: "pass" },
        { id: `B-${feature.id}`, gate: "sealed_step_3b", version: 1, status: "pass" },
      ],
      screenBearing: false,
      openCcrIds: [],
      earlierDoneFeatureIds: [],
    },
    taskIds: [feature.tasks],
    requirementIds: [feature.requirements],
    checkIds: feature.checks.split(",").filter((id) => id.length > 0),
    journeyEntryPoint: `/${feature.slug}`,
    staticAuditPaths: [`features/${feature.id}/`],
  };
}

function recordOf(landed: { featureId: string; mergeSha: string; parents: readonly string[]; trailers: { feature: string; tasks: readonly string[]; requirements: readonly string[]; checksPassed: string; harnessVersion: string } }): MergeCommitRecord {
  return {
    featureId: landed.featureId,
    sha: landed.mergeSha,
    subject: landed.featureId,
    parents: landed.parents.length,
    trailers: {
      "EF-Feature": landed.trailers.feature,
      "EF-Tasks": landed.trailers.tasks.join(","),
      "EF-Requirements": landed.trailers.requirements.join(","),
      "EF-Checks-Passed": landed.trailers.checksPassed,
      "EF-Harness-Version": landed.trailers.harnessVersion,
    },
    branch: `harness/f/${landed.featureId}`,
  };
}

export async function landFeatures(dir: string, features: readonly QueueFeature[]): Promise<MergeReport> {
  initRepo(dir);
  for (const feature of features) addFeature(dir, feature);
  const queue = new ProjectMergeQueue({ repo: dir, stateFile: path.join(dir, "merge-queue.db") });
  try {
    for (const feature of features) queue.enqueue(requestFor(feature));
    const report = await queue.drain();
    const commits = report.landed.map((landed) => recordOf(landed));
    let serial = true;
    for (let index = 1; index < commits.length; index += 1) {
      const current = commits[index];
      const previous = commits[index - 1];
      if (!current || !previous) {
        serial = false;
        break;
      }
      const parents = git(dir, ["rev-list", "--parents", "-n", "1", current.sha]).split(/\s+/);
      if (!parents.includes(previous.sha)) serial = false;
    }
    git(dir, ["checkout", "--force", "harness/integration"]);
    return {
      commits,
      held: report.evicted.map((item) => item.featureId),
      clean: report.blocked === null && report.escalations.length === 0,
      sameSecondSerialized: serial,
    };
  } finally {
    queue.close();
  }
}

export async function bisectHalves(ids: readonly string[]): Promise<string[][]> {
  const halves: string[][] = [];
  const batch: QueuedFeature[] = ids.map((id, index) => ({
    id: `mq-${index + 1}`,
    featureId: id,
    featureRef: `refs/heads/harness/f/${id}`,
    priority: 0,
    sequence: index + 1,
    status: "QUEUED",
    phase: "queued",
    evictionCount: 0,
    failureTrace: "",
    request: {
      featureId: id,
      featureRef: `refs/heads/harness/f/${id}`,
      spec: { id, title: id, text: id, contracts: [] },
      snapshot: {
        tasks: [],
        requirements: [],
        scopes: [],
        checks: [],
        screenBearing: false,
        openCcrIds: [],
        earlierDoneFeatureIds: [],
      },
      taskIds: [],
      requirementIds: [],
      checkIds: [],
      journeyEntryPoint: "/",
      staticAuditPaths: [],
    },
    mergeSha: "",
  }));
  const bisector = new MergeBatchBisector({
    probe: (features) => {
      const names = features.map((feature) => feature.featureId);
      if (names.length === 1) halves.push(names);
      const failed = names.includes("F-Orders");
      return Promise.resolve({
        ok: !failed,
        trace: failed ? "F-Orders regression" : "",
        failingChecks: [],
        kind: "gate" as const,
      });
    },
    land: () => Promise.resolve(),
    evict: () => undefined,
    interact: () => Promise.resolve(),
  });
  await bisector.resolve(batch);
  return halves;
}

export function trackedViews(dir: string): number {
  const listed = git(dir, ["ls-files", "--", ".harness/views"]);
  if (!listed) return 0;
  return listed.split(/\r?\n/).filter((line) => line.length > 0).length;
}
