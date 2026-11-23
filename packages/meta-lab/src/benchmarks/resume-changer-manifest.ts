import fs from "node:fs";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import { BenchmarkIntegrityError } from "./errors.js";
import type { ResumeChangerBenchmarkManifest } from "./types.js";

export function loadResumeChangerBenchmarkManifest(): ResumeChangerBenchmarkManifest {
  const absolute = canonicalAssetAbsolute("resumeChangerBenchmark");
  const text = fs.readFileSync(absolute, "utf8");
  return JSON.parse(text) as ResumeChangerBenchmarkManifest;
}

export function verifyResumeChangerManifestParity(manifest: ResumeChangerBenchmarkManifest): void {
  if (manifest.commit !== "497831ec5aa7effb354bb1a8d22d2f031b17a4e0") {
    throw new BenchmarkIntegrityError("resume-changer commit pin mismatch");
  }
  if (manifest.repository !== "AyushGahtori/resume-changer") {
    throw new BenchmarkIntegrityError("resume-changer repository pin mismatch");
  }
  if (manifest.summary.markdown_files !== 73) {
    throw new BenchmarkIntegrityError("resume-changer markdown_files count mismatch");
  }
  if (manifest.summary.plan_or_task_files !== 17) {
    throw new BenchmarkIntegrityError("resume-changer plan_or_task_files count mismatch");
  }
  if (manifest.summary.plan_or_task_lines !== 4906) {
    throw new BenchmarkIntegrityError("resume-changer plan_or_task_lines count mismatch");
  }
  const docs = manifest.files.filter((file) => file.path.startsWith("docs/"));
  if (docs.length !== 73) {
    throw new BenchmarkIntegrityError("resume-changer docs/*.md file count mismatch");
  }
  const planFiles = manifest.files.filter((file) => file.plan_or_task);
  if (planFiles.length !== 17) {
    throw new BenchmarkIntegrityError("resume-changer plan/task file count mismatch");
  }
}