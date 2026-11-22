import { spawnSync } from "node:child_process";
import { gitOk } from "./git.js";

const SKIP = /\.(?:skip|only)\s*\(|\b(?:xit|xtest|xdescribe)\s*\(|\b(?:it|test|describe)\.skip\b/;
const UNFINISHED = /not implemented/i;
const OURS = "<".repeat(7);
const THEIRS = ">".repeat(7);

function secretNeedles(): string[] {
  return [
    ["sk", "_live_"].join(""),
    ["sk-ant", "-"].join(""),
    ["sk-proj", "-"].join(""),
    ["ghp", "_"].join(""),
    ["AK", "IA"].join(""),
    ["BEGIN ", "PRIVATE KEY"].join(""),
  ];
}

export function auditText(label: string, text: string): string[] {
  const findings: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith(OURS) || line.startsWith(THEIRS)) findings.push(`${label}: unresolved conflict marker`);
    if (SKIP.test(line)) findings.push(`${label}: skipped or exclusive test`);
    if (UNFINISHED.test(line)) findings.push(`${label}: unfinished marker`);
  }
  return findings;
}

export function auditDiff(diff: string): { ok: boolean; trace: string } {
  const findings: string[] = [];
  let file = "diff";
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    findings.push(...auditText(file, line.slice(1)));
  }
  return { ok: findings.length === 0, trace: findings.join("\n") };
}

export function scanSecrets(diff: string): { ok: boolean; trace: string } {
  const findings: string[] = [];
  for (const needle of secretNeedles()) {
    if (diff.includes(needle)) findings.push("secret pattern in the merge diff");
  }
  const accessKey = new RegExp(`${["AK", "IA"].join("")}[0-9A-Z]{16}`);
  if (accessKey.test(diff)) findings.push("access-key pattern in the merge diff");
  return { ok: findings.length === 0, trace: findings.join("\n") };
}

let gitleaksCommand: string | null | undefined;

export function gitleaksOnRange(repo: string, baseSha: string, headSha: string): { ok: boolean; trace: string; mode: "binary" | "builtin" } {
  const command = resolveGitleaks();
  if (!command) return { ok: true, trace: "builtin secret scan", mode: "builtin" };
  const result = spawnSync(command, ["detect", `--log-opts=${baseSha}..${headSha}`, "--redact", "--exit-code=1"], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status === null || result.status > 1) {
    return { ok: true, trace: "builtin secret scan (gitleaks could not run)", mode: "builtin" };
  }
  if (result.status === 1) {
    return { ok: false, trace: (result.stdout || result.stderr || "gitleaks found a secret").trim(), mode: "binary" };
  }
  return { ok: true, trace: "gitleaks clean", mode: "binary" };
}

function resolveGitleaks(): string | null {
  if (gitleaksCommand !== undefined) return gitleaksCommand;
  const result = spawnSync("gitleaks", ["version"], { encoding: "utf8", windowsHide: true, shell: false });
  gitleaksCommand = result.status === 0 ? "gitleaks" : null;
  return gitleaksCommand;
}

export function mergeDiff(repo: string, baseSha: string, headSha: string): string {
  return gitOk(repo, ["diff", "--unified=0", baseSha, headSha]).stdout;
}
