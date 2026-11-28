import { HumanStepError } from "./errors.js";
import { isCliToolName, isHumanStepType } from "./policy.js";
import type { ProbeResult, ProbeSpec } from "./types.js";

export function parseProbeSpec(value: unknown): ProbeSpec {
  if (!value || typeof value !== "object") throw new HumanStepError("probe_spec", "Probe spec must be an object");
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind === "playwright") return parsePlaywright(record);
  if (kind === "docker") return { kind };
  if (kind === "database_url") return parseDatabase(record);
  if (kind === "cli_tool") return parseCli(record);
  if (kind === "cloud_api") return parseCloud(record);
  if (kind === "dns") return parseDns(record);
  if (kind === "webhook") return parseWebhook(record);
  if (kind === "unprobeable") return { kind };
  throw new HumanStepError("probe_spec", "Unknown probe kind");
}

export function parseProbeResult(value: unknown): ProbeResult {
  if (!value || typeof value !== "object") throw new HumanStepError("probe_result", "Probe result must be an object");
  const record = value as Record<string, unknown>;
  const outcome = record.outcome;
  if (outcome !== "pass" && outcome !== "fail" && outcome !== "timeout") {
    throw new HumanStepError("probe_result", "Probe outcome is invalid");
  }
  const evidence = record.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new HumanStepError("probe_result", "Probe evidence must be an object");
  }
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(evidence)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") safe[key] = item;
  }
  return {
    outcome,
    code: requiredString(record, "code"),
    diagnosis: requiredString(record, "diagnosis"),
    durationMs: requiredNumber(record, "durationMs"),
    checkedAt: requiredNumber(record, "checkedAt"),
    evidence: safe,
  };
}

export function assertStepType(value: string): void {
  if (!isHumanStepType(value)) throw new HumanStepError("step_type", `Unsupported human step type ${value}`);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HumanStepError("probe_spec", `${key} must be a non-empty string`);
  }
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HumanStepError("probe_result", `${key} must be a finite number`);
  }
  return value;
}

function stringOrUndefined(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new HumanStepError("probe_spec", `${key} must be a non-empty string`);
  }
  return value;
}

function statusesOrUndefined(record: Record<string, unknown>): readonly number[] | undefined {
  const value = record.expectStatuses;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    throw new HumanStepError("probe_spec", "expectStatuses must be a list of numbers");
  }
  return value;
}

function parsePlaywright(record: Record<string, unknown>): ProbeSpec {
  const browsersPath = stringOrUndefined(record, "browsersPath");
  return {
    kind: "playwright",
    projectRoot: requiredString(record, "projectRoot"),
    ...(browsersPath === undefined ? {} : { browsersPath }),
    ...(record.requiredFor === "playwright_tests" ? { requiredFor: "playwright_tests" as const } : {}),
  };
}

function parseDatabase(record: Record<string, unknown>): ProbeSpec {
  const engine = record.engine;
  if (engine !== "postgres" && engine !== "redis") {
    throw new HumanStepError("probe_spec", "database_url engine must be postgres or redis");
  }
  return {
    kind: "database_url",
    secretId: requiredString(record, "secretId"),
    engine,
    ...(record.requiredFor === "migrations" ? { requiredFor: "migrations" as const } : {}),
  };
}

function parseCli(record: Record<string, unknown>): ProbeSpec {
  const tool = requiredString(record, "tool");
  if (!isCliToolName(tool)) throw new HumanStepError("probe_spec", `Unsupported CLI tool ${tool}`);
  const minimumVersion = stringOrUndefined(record, "minimumVersion");
  const install = parseInstall(record.install);
  return {
    kind: "cli_tool",
    tool,
    ...(minimumVersion === undefined ? {} : { minimumVersion }),
    ...(record.checkAuth === true ? { checkAuth: true } : record.checkAuth === false ? { checkAuth: false } : {}),
    ...(install === undefined ? {} : { install }),
  };
}

function parseInstall(value: unknown): { readonly file: string; readonly args: readonly string[] } | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new HumanStepError("probe_spec", "install must be a command");
  const record = value as Record<string, unknown>;
  const args = record.args;
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) {
    throw new HumanStepError("probe_spec", "install.args must be strings");
  }
  return { file: requiredString(record, "file"), args };
}

function parseCloud(record: Record<string, unknown>): ProbeSpec {
  const secretId = stringOrUndefined(record, "secretId");
  const expectStatuses = statusesOrUndefined(record);
  return {
    kind: "cloud_api",
    url: requiredString(record, "url"),
    ...(secretId === undefined ? {} : { secretId }),
    ...(expectStatuses === undefined ? {} : { expectStatuses }),
  };
}

function parseDns(record: Record<string, unknown>): ProbeSpec {
  const recordType = record.recordType;
  if (recordType !== "TXT" && recordType !== "CNAME") {
    throw new HumanStepError("probe_spec", "DNS recordType must be TXT or CNAME");
  }
  return {
    kind: "dns",
    hostname: requiredString(record, "hostname"),
    recordType,
    expected: requiredString(record, "expected"),
  };
}

function parseWebhook(record: Record<string, unknown>): ProbeSpec {
  const expectStatuses = statusesOrUndefined(record);
  return {
    kind: "webhook",
    url: requiredString(record, "url"),
    ...(expectStatuses === undefined ? {} : { expectStatuses }),
  };
}
