import https from "node:https";
import { Resolver } from "node:dns/promises";

import { diagnoseCaught } from "./diagnosis.js";
import type { DnsResolver, HttpProbe, HttpProbeRequest, ProbeLogger, WindowsDpapiSecretsVault } from "./ports.js";
import { scrubSecrets } from "./redact.js";
import { PROBE_TIMEOUT_DIAGNOSIS, type ProbeResult } from "./types.js";

export function nodeDnsResolver(): DnsResolver {
  const resolver = new Resolver();
  return {
    async resolveTxt(hostname: string): Promise<readonly string[]> {
      const rows = await resolver.resolveTxt(hostname);
      return rows.map((parts) => parts.join(""));
    },
    resolveCname(hostname: string): Promise<readonly string[]> {
      return resolver.resolveCname(hostname);
    },
  };
}

export function nodeHttpProbe(): HttpProbe {
  return {
    request(input: HttpProbeRequest): Promise<{ readonly status: number }> {
      return requestHttps(input);
    },
  };
}

export async function probeDns(input: {
  readonly hostname: string;
  readonly recordType: "TXT" | "CNAME";
  readonly expected: string;
  readonly resolver: DnsResolver;
  readonly now: () => number;
  readonly logger: ProbeLogger;
}): Promise<ProbeResult> {
  const started = input.now();
  input.logger.write("dns_probe", { hostname: input.hostname, recordType: input.recordType, readOnly: true });
  try {
    const values =
      input.recordType === "TXT"
        ? await input.resolver.resolveTxt(input.hostname)
        : await input.resolver.resolveCname(input.hostname);
    const matched = values.some((value) => value === input.expected || value.includes(input.expected));
    if (!matched) {
      return done(input.now, started, "fail", "DNS_MISMATCH", `${input.recordType} for ${input.hostname} does not match the expected value`, {
        hostname: input.hostname,
        recordType: input.recordType,
        readOnly: true,
      });
    }
    return done(input.now, started, "pass", "DNS_MATCH", `${input.recordType} for ${input.hostname} matches`, {
      hostname: input.hostname,
      recordType: input.recordType,
      readOnly: true,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "PROBE_TIMEOUT" || code === "ETIMEOUT" || code === "ETIMEDOUT") {
      return done(input.now, started, "timeout", "PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS, { hostname: input.hostname, readOnly: true });
    }
    return done(input.now, started, "fail", "DNS_LOOKUP_FAILED", diagnoseCaught(error), {
      hostname: input.hostname,
      recordType: input.recordType,
      readOnly: true,
    });
  }
}

export async function probeHttps(input: {
  readonly kind: "cloud_api" | "webhook";
  readonly url: string;
  readonly secretId?: string;
  readonly expectStatuses?: readonly number[];
  readonly vault: WindowsDpapiSecretsVault;
  readonly http: HttpProbe;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly logger: ProbeLogger;
}): Promise<ProbeResult> {
  const started = input.now();
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return done(input.now, started, "fail", "BAD_URL", "The probe URL is not a valid HTTPS URL", { readOnly: true });
  }
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0) {
    return done(input.now, started, "fail", "HTTPS_ONLY", "Cloud and webhook probes only call HTTPS URLs without embedded credentials", {
      readOnly: true,
    });
  }
  const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9, */*;q=0.8" };
  let secret = "";
  if (input.secretId) {
    const value = await input.vault.readSecret(input.secretId);
    if (value === null || value.length === 0) {
      return done(input.now, started, "fail", "MISSING_SECRET", "No API credential is stored for this probe", { readOnly: true });
    }
    secret = value;
    headers.authorization = `Bearer ${value}`;
  }
  input.logger.write("https_probe", {
    kind: input.kind,
    host: parsed.hostname,
    authorization: input.secretId ? "present" : "absent",
    readOnly: true,
  });
  try {
    const response = await input.http.request({
      url: input.url,
      method: "GET",
      headers,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    const expected = input.expectStatuses ?? (input.kind === "webhook" ? reachableStatuses() : successStatuses());
    if (!expected.includes(response.status)) {
      return done(input.now, started, "fail", "HTTP_STATUS", `HTTPS probe received status ${response.status}`, {
        host: parsed.hostname,
        status: response.status,
        readOnly: true,
      });
    }
    return done(input.now, started, "pass", "HTTPS_OK", `HTTPS probe reached ${parsed.hostname}`, {
      host: parsed.hostname,
      status: response.status,
      readOnly: true,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "PROBE_TIMEOUT" || code === "ECONNRESET" || code === "ETIMEDOUT" || input.signal.aborted) {
      return done(input.now, started, "timeout", "PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS, { host: parsed.hostname, readOnly: true });
    }
    return done(input.now, started, "fail", "HTTPS_UNREACHABLE", scrubSecrets(diagnoseCaught(error), [secret]), {
      host: parsed.hostname,
      readOnly: true,
    });
  }
}

function requestHttps(input: HttpProbeRequest): Promise<{ readonly status: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.url);
    const request = https.request(
      url,
      {
        method: input.method,
        headers: input.headers,
        timeout: input.timeoutMs,
      },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      },
    );
    const fail = (error: unknown): void => {
      request.destroy();
      reject(error);
    };
    input.signal.addEventListener("abort", () => fail(abortError()), { once: true });
    request.once("timeout", () => fail(abortError()));
    request.once("error", fail);
    request.end();
  });
}

function abortError(): Error {
  const error = new Error(PROBE_TIMEOUT_DIAGNOSIS);
  (error as NodeJS.ErrnoException).code = "PROBE_TIMEOUT";
  return error;
}

function successStatuses(): number[] {
  return Array.from({ length: 100 }, (_item, index) => 200 + index);
}

function reachableStatuses(): number[] {
  return Array.from({ length: 300 }, (_item, index) => 200 + index);
}

function done(
  now: () => number,
  started: number,
  outcome: ProbeResult["outcome"],
  code: string,
  diagnosis: string,
  evidence: Record<string, string | number | boolean>,
): ProbeResult {
  return { outcome, code, diagnosis, durationMs: Math.max(0, now() - started), checkedAt: now(), evidence };
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}
