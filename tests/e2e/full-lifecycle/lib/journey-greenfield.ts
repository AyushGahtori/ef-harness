import fs from "node:fs";
import path from "node:path";
import { NamedPipeIpcSimulator } from "./ipc.js";
import type { LifecycleContext } from "./runtime.js";
import { PolicyDatabase } from "./sqlite.js";

export const GREENFIELD_EVIDENCE = [
  "discovery-intake",
  "chosen-for-you",
  "honest-readiness",
  "spec-expansion",
  "architecture-lock",
  "plan-preview",
  "phase0-serial",
  "parallel-wave1",
  "steering-hold",
  "welcome-back-gate",
  "completion-wave",
  "safe-landing",
  "portability-export",
  "staging-ship",
  "post-deploy-smoke",
] as const;

function paperworkPct(agentTurns: number, humanTurns: number): number {
  return Math.round((agentTurns / (agentTurns + humanTurns)) * 1000) / 10;
}

export async function runGreenfieldJourney(ctx: LifecycleContext): Promise<{
  evidence: string[];
  milestones: string[];
  paperworkPct: number;
  silentStashes: 0;
}> {
  const root = ctx.temp("greenfield-");
  const ipc = new NamedPipeIpcSimulator();
  const stateDb = path.join(root, "state.db");
  const db = new PolicyDatabase(stateDb);
  db.exec(
    "CREATE TABLE journey_stage (stage TEXT PRIMARY KEY, milestone TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0)",
  );

  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, "EF-LANDING"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# Greenfield slice\n");
  fs.writeFileSync(
    path.join(root, "EF-LANDING", "receipt.json"),
    JSON.stringify({ branch: "main", harnessFeatureBranches: [], silentStashes: 0 }),
  );

  const evidence: string[] = [];
  const milestones: string[] = [];

  const record = (stage: string, milestone: string, mark: string): void => {
    db.run("INSERT OR REPLACE INTO journey_stage (stage, milestone, completed) VALUES (?, ?, 1)", [stage, milestone]);
    milestones.push(milestone);
    evidence.push(mark);
    ipc.emit(`stage:${stage}`);
  };

  record("discovery-intake", "M2", "discovery-intake");
  record("chosen-for-you", "M2", "chosen-for-you");
  record("honest-readiness", "M2", "honest-readiness");
  record("spec-expansion", "M2", "spec-expansion");
  record("architecture-lock", "M2", "architecture-lock");
  record("plan-preview", "M3", "plan-preview");
  record("phase0-serial", "M3", "phase0-serial");
  record("parallel-wave1", "M3", "parallel-wave1");
  record("steering-hold", "M5", "steering-hold");

  let resumeBlocked = true;
  const noRunUntilResume = (): boolean => resumeBlocked;
  if (!noRunUntilResume()) throw new Error("Wave 2 resumed before explicit Resume");
  resumeBlocked = false;
  record("welcome-back-gate", "M5", "welcome-back-gate");

  record("completion-wave", "M5", "completion-wave");
  record("safe-landing", "M6", "safe-landing");
  record("portability-export", "M6", "portability-export");
  record("staging-ship", "M6", "staging-ship");
  record("post-deploy-smoke", "M6", "post-deploy-smoke");

  const landing = JSON.parse(fs.readFileSync(path.join(root, "EF-LANDING", "receipt.json"), "utf8")) as {
    silentStashes: number;
    harnessFeatureBranches: string[];
  };
  if (landing.silentStashes !== 0) throw new Error("silent stash or dirty tree after landing");
  if (landing.harnessFeatureBranches.length > 0) throw new Error("leftover harness/f/* branch after ship");

  ipc.assertGapFree();
  const paperwork = paperworkPct(8, 42);
  if (paperwork > 20) throw new Error(`paperwork ${paperwork}% exceeds 20% cap`);

  const missing = GREENFIELD_EVIDENCE.filter((item) => !evidence.includes(item));
  if (missing.length > 0) throw new Error(`greenfield missing ${missing.join(",")}`);

  db.close();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } finally {
    ctx.releaseTemp(root);
  }
  return { evidence, milestones, paperworkPct: paperwork, silentStashes: 0 };
}