import fs from "node:fs";
import { DOC_COUNT, PINNED_COMMIT, PLAN_FILE_COUNT, PLAN_LINE_COUNT } from "./constants.js";
import { benchmarkJsonPath } from "./paths.js";

export interface ManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly lines: number;
  readonly planOrTask: boolean;
}

export interface ManifestParity {
  readonly ok: boolean;
  readonly commit: string;
  readonly docCount: number;
  readonly planFileCount: number;
  readonly planLineCount: number;
  readonly problems: readonly string[];
  readonly files: readonly ManifestFile[];
}

export function loadResumeChangerManifest(filePath = benchmarkJsonPath()): ManifestParity {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyManifest([`unreadable benchmark: ${message}`]);
  }
  if (!parsed || typeof parsed !== "object") return emptyManifest(["benchmark is not an object"]);
  const record = parsed as Record<string, unknown>;
  const commit = typeof record.commit === "string" ? record.commit : "";
  if (commit !== PINNED_COMMIT) problems.push("commit");
  const files = parseFiles(record.files, problems);
  const planFiles = files.filter((file) => file.planOrTask);
  const planLines = planFiles.reduce((sum, file) => sum + file.lines, 0);
  if (files.length !== DOC_COUNT) problems.push("docCount");
  if (planFiles.length !== PLAN_FILE_COUNT) problems.push("planFileCount");
  if (planLines !== PLAN_LINE_COUNT) problems.push("planLineCount");
  const summary = record.summary;
  if (!summary || typeof summary !== "object") {
    problems.push("summary");
  } else {
    const card = summary as Record<string, unknown>;
    if (card.markdown_files !== DOC_COUNT) problems.push("summaryDocs");
    if (card.plan_or_task_files !== PLAN_FILE_COUNT) problems.push("summaryPlans");
    if (card.plan_or_task_lines !== PLAN_LINE_COUNT) problems.push("summaryLines");
  }
  return {
    ok: problems.length === 0,
    commit,
    docCount: files.length,
    planFileCount: planFiles.length,
    planLineCount: planLines,
    problems,
    files,
  };
}

function parseFiles(value: unknown, problems: string[]): ManifestFile[] {
  if (!Array.isArray(value)) {
    problems.push("files");
    return [];
  }
  const files: ManifestFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      problems.push("fileShape");
      continue;
    }
    const row = entry as Record<string, unknown>;
    const filePath = typeof row.path === "string" ? row.path : "";
    const sha256 = typeof row.sha256 === "string" ? row.sha256 : "";
    const lines = typeof row.lines === "number" ? row.lines : -1;
    const planOrTask = row.plan_or_task === true;
    if (!filePath.startsWith("docs/") || !filePath.endsWith(".md")) problems.push("docPath");
    if (!/^[0-9a-f]{64}$/.test(sha256)) problems.push("sha256");
    if (!Number.isInteger(lines) || lines < 0) problems.push("lines");
    files.push({ path: filePath, sha256, lines, planOrTask });
  }
  return files;
}

function emptyManifest(problems: readonly string[]): ManifestParity {
  return {
    ok: false,
    commit: "",
    docCount: 0,
    planFileCount: 0,
    planLineCount: 0,
    problems,
    files: [],
  };
}
