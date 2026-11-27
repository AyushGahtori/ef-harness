import { createHash } from "node:crypto";
import { EF_TRAILER_KEYS } from "./constants.js";
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
  readonly harnessVersion: string;
}): EfTrailers {
  return {
    feature: input.featureId,
    tasks: [...new Set(input.taskIds)].sort(),
    requirements: [...new Set(input.requirementIds)].sort(),
    checksPassed: receiptSha(input.featureId, input.checkIds),
    harnessVersion: input.harnessVersion,
  };
}

export function trailerLines(trailers: EfTrailers): readonly { key: string; value: string }[] {
  return [
    { key: "EF-Feature", value: trailers.feature },
    { key: "EF-Tasks", value: trailers.tasks.join(",") },
    { key: "EF-Requirements", value: trailers.requirements.join(",") },
    { key: "EF-Checks-Passed", value: trailers.checksPassed },
    { key: "EF-Harness-Version", value: trailers.harnessVersion },
  ];
}

export function renderCommitMessage(
  repo: string,
  subject: string,
  body: string,
  trailers: EfTrailers,
): string {
  const args = ["interpret-trailers"];
  for (const trailer of trailerLines(trailers)) {
    args.push("--trailer", `${trailer.key}: ${trailer.value}`);
  }
  return gitOk({
    repo,
    args,
    input: `${subject.trim()}\n\n${body.trim()}\n`,
  }).stdout;
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
    tasks: (values.get("EF-Tasks") ?? "").split(",").filter((item) => item.length > 0),
    requirements: (values.get("EF-Requirements") ?? "").split(",").filter((item) => item.length > 0),
    checksPassed: values.get("EF-Checks-Passed") ?? "",
    harnessVersion: values.get("EF-Harness-Version") ?? "",
  };
}
