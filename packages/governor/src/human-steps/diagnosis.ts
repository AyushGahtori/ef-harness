import { scrubSecrets } from "./redact.js";
import {
  DOCKER_NOT_INSTALLED_DIAGNOSIS,
  DOCKER_NOT_RUNNING_DIAGNOSIS,
  PROBE_TIMEOUT_DIAGNOSIS,
} from "./types.js";

const DOCKER_STOPPED = /dockerDesktopLinuxEngine|error during connect|cannot connect to the docker daemon|docker daemon is not running|\/\/\.\/pipe\/docker/i;

const NOT_FOUND = /enoent|not recognized as an internal or external command|command not found|no such file or directory/i;

export function isDockerDaemonDown(text: string): boolean {
  return DOCKER_STOPPED.test(text);
}

export function isCommandMissing(text: string, errorCode: string | null): boolean {
  return errorCode === "ENOENT" || NOT_FOUND.test(text);
}

export function dockerFailureCode(text: string, errorCode: string | null): "NOT_INSTALLED" | "INSTALLED_NOT_RUNNING" | "DOCKER_UNAVAILABLE" {
  if (isDockerDaemonDown(text)) return "INSTALLED_NOT_RUNNING";
  if (isCommandMissing(text, errorCode)) return "NOT_INSTALLED";
  return "DOCKER_UNAVAILABLE";
}

export function dockerFailureDiagnosis(code: "NOT_INSTALLED" | "INSTALLED_NOT_RUNNING" | "DOCKER_UNAVAILABLE"): string {
  if (code === "NOT_INSTALLED") return DOCKER_NOT_INSTALLED_DIAGNOSIS;
  if (code === "INSTALLED_NOT_RUNNING") return DOCKER_NOT_RUNNING_DIAGNOSIS;
  return "Docker did not answer docker info — start Docker Desktop and click Check again";
}

export function connectionRefusedDiagnosis(detail: string): string {
  const match = /(\d{1,3}(?:\.\d{1,3}){3}:\d+|\[[^\]]+\]:\d+)/.exec(detail);
  const target = match?.[1] ?? "the service";
  return `Nothing is accepting connections on ${target} — start the service and click Check again`;
}

export function commandMissingDiagnosis(tool: string): string {
  return `${tool} was not found — install ${tool} and click Check again`;
}

export function diagnoseCaught(error: unknown, secrets: readonly string[] = []): string {
  if (isTimeoutLike(error)) return PROBE_TIMEOUT_DIAGNOSIS;
  const raw = error instanceof Error ? `${error.message}` : String(error);
  const code = errorCodeOf(error);
  const text = `${code ?? ""} ${raw}`;
  if (isDockerDaemonDown(text)) return DOCKER_NOT_RUNNING_DIAGNOSIS;
  if (/ECONNREFUSED/i.test(text)) return connectionRefusedDiagnosis(text);
  if (isCommandMissing(text, code)) return "The required command was not found — install it and click Check again";
  const scrubbed = scrubSecrets(raw, secrets).replace(/\s+/g, " ").trim();
  if (scrubbed.length === 0) return "The probe failed. Click Check again after fixing the reported problem";
  return scrubbed.length > 240 ? `${scrubbed.slice(0, 237)}...` : scrubbed;
}

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "PROBE_TIMEOUT" || code === "ETIMEDOUT";
}

function errorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  return typeof code === "string" ? code : null;
}
