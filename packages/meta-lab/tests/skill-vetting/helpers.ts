import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CanarySkillQuarantineHarness,
  LocalPacketSecurityRedactor,
  LocalSandboxPolicy,
  SkillTokenBudgetEnforcer,
  StaticSkillSecurityVetter,
  type NativeWorkerLoopPort,
} from "../../src/skill-vetting/index.js";

export function scratchParent(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ef-skill-parent-"));
}

export type ScratchCleanup = () => void;

export function harnessFor(worker: NativeWorkerLoopPort): CanarySkillQuarantineHarness {
  return new CanarySkillQuarantineHarness({
    vetter: new StaticSkillSecurityVetter(),
    budget: new SkillTokenBudgetEnforcer(),
    redactor: new LocalPacketSecurityRedactor(),
    sandbox: new LocalSandboxPolicy(),
    worker,
    now: () => "2026-11-20T12:00:00.000Z",
  });
}