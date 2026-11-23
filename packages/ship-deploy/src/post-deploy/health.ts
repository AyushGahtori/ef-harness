import {
  DevArtifactLeakError,
  HealthCheckTimeoutError,
  StackTraceLeakError,
  StaleDeploymentBuildIdMismatch,
  TlsCertificateError,
} from "./errors.js";
import {
  HEALTH_WARMUP_INTERVAL_MS,
  HEALTH_WARMUP_MAX_MS,
  containsStackTrace,
  defaultTls,
  extractBuildId,
  fetchReadOnly,
  readOnlyRequest,
  hasDataEfSource,
  isHtml,
  joinUrl,
  systemClock,
} from "./http.js";
import type { Clock, HealthCheckInput, HealthCheckResult, TlsProbe } from "./types.js";

export interface HealthVerifierOptions {
  readonly clock?: Clock;
  readonly tlsProbe?: TlsProbe;
  readonly fetchImpl?: typeof fetch;
}

interface Attempt {
  readonly status: number;
  readonly buildId: string | null;
  readonly headers: Headers;
  readonly body: string;
  readonly contentType: string;
  readonly healthUrl: string;
}

export async function verifyHealthAndBuildId(
  input: HealthCheckInput,
  options: HealthVerifierOptions = {},
): Promise<HealthCheckResult> {
  const clock = options.clock ?? systemClock;
  const tlsProbe = options.tlsProbe ?? defaultTls;
  const maxWaitMs = input.maxWaitMs ?? HEALTH_WARMUP_MAX_MS;
  const intervalMs = input.intervalMs ?? HEALTH_WARMUP_INTERVAL_MS;
  const healthPath = input.healthPath ?? "/api/health";
  const live = new URL(input.liveUrl);
  const tls = await tlsProbe(live);
  if (!tls.valid) {
    throw new TlsCertificateError(tls.reason ?? "TLS certificate is not valid");
  }

  const started = clock.now();
  const deadline = started + maxWaitMs;
  const maxAttempts = Math.max(1, Math.ceil(maxWaitMs / Math.max(intervalMs, 1)) + 1);
  let attempts = 0;
  let lastStatus = 0;
  let lastBuildId: string | null = null;
  let sawMismatch = false;

  while (attempts < maxAttempts) {
    attempts += 1;
    let attempt: Attempt;
    try {
      attempt = await readHealth(input.liveUrl, healthPath, options.fetchImpl);
    } catch (error) {
      if (error instanceof TlsCertificateError || error instanceof StackTraceLeakError) throw error;
      lastStatus = 0;
      if (clock.now() >= deadline || attempts >= maxAttempts) break;
      await clock.wait(Math.min(intervalMs, Math.max(0, deadline - clock.now())));
      continue;
    }

    lastStatus = attempt.status;
    if (attempt.status === 200) {
      if (containsStackTrace(attempt.headers, attempt.body)) {
        throw new StackTraceLeakError("health response exposed a stack trace");
      }
      lastBuildId = attempt.buildId;
      if (attempt.buildId === input.expectedCommitSha) {
        const production = await assertProductionArtifacts(
          input,
          attempt,
          options.fetchImpl,
        );
        return {
          liveUrl: input.liveUrl,
          healthUrl: attempt.healthUrl,
          buildId: attempt.buildId,
          status: attempt.status,
          tls,
          attempts,
          passedAt: new Date(clock.now()).toISOString(),
          styleguideStatus: production.styleguideStatus,
        };
      }
      sawMismatch = true;
    }

    if (clock.now() >= deadline || attempts >= maxAttempts) break;
    await clock.wait(Math.min(intervalMs, Math.max(0, deadline - clock.now())));
  }

  if (sawMismatch || (lastStatus === 200 && lastBuildId !== input.expectedCommitSha)) {
    throw new StaleDeploymentBuildIdMismatch({
      expectedCommitSha: input.expectedCommitSha,
      actualBuildId: lastBuildId,
      liveUrl: input.liveUrl,
      attempts,
    });
  }
  throw new HealthCheckTimeoutError(
    `health endpoint did not return HTTP 200 within ${maxWaitMs}ms (last status ${lastStatus})`,
    attempts,
  );
}

async function readHealth(
  liveUrl: string,
  healthPath: string,
  fetchImpl: typeof fetch | undefined,
): Promise<Attempt> {
  const healthUrl = joinUrl(liveUrl, healthPath);
  const response = await fetchReadOnly(healthUrl, readOnlyRequest("follow", fetchImpl));
  return {
    status: response.status,
    buildId: extractBuildId(response.headers, response.body),
    headers: response.headers,
    body: response.body,
    contentType: response.contentType,
    healthUrl,
  };
}

async function assertProductionArtifacts(
  input: HealthCheckInput,
  attempt: Attempt,
  fetchImpl: typeof fetch | undefined,
): Promise<{ readonly styleguideStatus: number | null }> {
  if (input.env !== "production") {
    return { styleguideStatus: null };
  }
  const homeUrl = joinUrl(input.liveUrl, "/");
  const home =
    attempt.healthUrl === homeUrl
      ? {
          body: attempt.body,
          contentType: attempt.contentType,
          headers: attempt.headers,
        }
      : await fetchReadOnly(homeUrl, readOnlyRequest("follow", fetchImpl));
  if (containsStackTrace(home.headers, home.body)) {
    throw new StackTraceLeakError("production HTML exposed a stack trace");
  }
  if (isHtml(home.contentType, home.body) && hasDataEfSource(home.body)) {
    throw new DevArtifactLeakError(
      "data-ef-source",
      "production HTML contains data-ef-source attributes",
    );
  }
  const styleguide = await fetchReadOnly(
    joinUrl(input.liveUrl, "/__styleguide"),
    readOnlyRequest("manual", fetchImpl),
  );
  if (styleguide.status !== 404) {
    throw new DevArtifactLeakError(
      "styleguide",
      `/__styleguide returned HTTP ${styleguide.status} in production`,
    );
  }
  if (containsStackTrace(styleguide.headers, styleguide.body)) {
    throw new StackTraceLeakError("production response exposed a stack trace");
  }
  return { styleguideStatus: styleguide.status };
}
