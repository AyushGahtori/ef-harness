import { createHash } from "node:crypto";
import { EF_TRAILER_KEYS, HARNESS_VERSION } from "./constants.js";
import { gitOk } from "./git.js";
import type { EfTrailers } from "./types.js";

export function receiptSha(featureId: string, checkIds: readonly string[]): string {
  const checks = [...new Set(checkIds)].sort().map((id) => ({ id, status: "pass" }));
  const canonical = JSON.stringify({ checks, feature: featureId });
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildTrailers(input: {
  readonly featureId: string;
  readonly taskIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly checkIds: readonly string[];
}): EfTrailers {
  return {
    feature: input.featureId,
    tasks: [...new Set(input.taskIds)].sort(),
    requirements: [...new Set(input.requirementIds)].sort(),
    checksPassed: receiptSha(input.featureId, input.checkIds),
    harnessVersion: HARNESS_VERSION,
  };
}

export function renderCommitMessage(repo: string, subject: string, body: string, trailers: EfTrailers): string {
  const args = ["interpret-trailers"];
  const pairs: readonly (readonly [string, string])[] = [
    ["EF-Feature", trailers.feature],
    ["EF-Tasks", trailers.tasks.join(",")],
    ["EF-Requirements", trailers.requirements.join(",")],
    ["EF-Checks-Passed", trailers.checksPassed],
    ["EF-Harness-Version", trailers.harnessVersion],
  ];
  for (const [key, value] of pairs) {
    args.push("--trailer", `${key}: ${value}`);
  }
  return gitOk(repo, args, `${subject.trim()}\n\n${body.trim()}\n`).stdout;
}

export function parseEfTrailers(message: string): EfTrailers | null {
  const values = new Map<string, string>();
  for (const line of message.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    values.set(match[1], (match[2] ?? "").trim());
  }
  for (const key of EF_TRAILER_KEYS) {
    if (!values.get(key)) return null;
  }
  return {
    feature: values.get("EF-Feature") ?? "",
    tasks: splitList(values.get("EF-Tasks") ?? ""),
    requirements: splitList(values.get("EF-Requirements") ?? ""),
    checksPassed: values.get("EF-Checks-Passed") ?? "",
    harnessVersion: values.get("EF-Harness-Version") ?? "",
  };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
