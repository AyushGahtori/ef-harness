import type { CleanVerifierRunner } from "./runner/clean-verifier-runner.js";
import type {
  SurfaceCheckResult,
  SurfaceCollectInput,
  SurfaceVerifierAdapter,
} from "./runner/ports.js";
import type { CheckSurface, RunSignals } from "./runner/types.js";
import { ApiContractVerifier } from "./surfaces/api-contract-verifier.js";
import { AuthCallbackVerifier } from "./surfaces/auth-callback-verifier.js";
import { BackgroundJobVerifier } from "./surfaces/background-job-verifier.js";
import { CliSurfaceVerifier } from "./surfaces/cli-surface-verifier.js";
import { MigrationPreservationVerifier } from "./surfaces/migration-preservation-verifier.js";
import { TimeBoundaryVerifier } from "./surfaces/time-boundary-verifier.js";
import type {
  SurfaceCheckResult as DomainSurfaceCheckResult,
  SurfaceCheckVerifier,
  SurfaceVerifierContext,
} from "./surfaces/types.js";
import type { CasBlobStorePort, HintLadderPort } from "./ui-contract/ports.js";
import { UiInteractionContractVerifier } from "./ui-contract/verifier.js";

export interface IntegratedSurfaceDeps {
  readonly ui: {
    readonly cas: CasBlobStorePort;
    readonly hintLadder?: HintLadderPort;
  };
}

/**
 * Registers the Task 062 UI verifier and the Task 063 verifiers whose domain
 * surface is already a `CheckSurface`. Webhook, rate-limit, and concurrency
 * stay on the local surface registry: `CheckSurface` has no token for them.
 * `RedBeforeGreenGate` stays a gate, not a surface collector.
 */
export function registerIntegratedSurfaceVerifiers(
  runner: CleanVerifierRunner,
  deps: IntegratedSurfaceDeps,
): void {
  for (const adapter of integratedSurfaceAdapters(deps)) {
    runner.registerSurfaceVerifier(adapter);
  }
}

export function integratedSurfaceAdapters(deps: IntegratedSurfaceDeps): readonly SurfaceVerifierAdapter[] {
  const domain: SurfaceCheckVerifier[] = [
    new ApiContractVerifier(),
    new AuthCallbackVerifier(),
    new TimeBoundaryVerifier(),
    new BackgroundJobVerifier(),
    new CliSurfaceVerifier(),
    new MigrationPreservationVerifier(),
  ];
  return [
    uiPlaywrightSurfaceAdapter(new UiInteractionContractVerifier(deps.ui)),
    ...domain.map((verifier) => domainSurfaceAdapter(verifier)),
  ];
}

export function uiPlaywrightSurfaceAdapter(verifier: UiInteractionContractVerifier): SurfaceVerifierAdapter {
  return {
    id: verifier.id,
    supports(check) {
      return check.surface === "browser";
    },
    collect(input) {
      return verifier.collect({
        env: input.env,
        checks: input.checks.map((check) => ({
          checkId: check.checkId,
          surface: check.surface,
          input: check.input,
        })),
      });
    },
  };
}

function domainSurfaceAdapter(verifier: SurfaceCheckVerifier): SurfaceVerifierAdapter {
  const surface = asCheckSurface(verifier.surface);
  return {
    id: verifier.id,
    supports(check) {
      return surface !== undefined && check.surface === surface;
    },
    async collect(input) {
      if (surface === undefined) return [];
      const owned = input.checks.filter((check) => check.surface === surface);
      const context = contextFrom(input);
      const collected: SurfaceCheckResult[] = [];
      for (const check of owned) {
        const results = await verifier.verify(check.input, context);
        collected.push(aggregate(check.checkId, results));
      }
      return collected;
    },
  };
}

function asCheckSurface(surface: string): CheckSurface | undefined {
  if (
    surface === "api" ||
    surface === "auth" ||
    surface === "cli" ||
    surface === "migration" ||
    surface === "time" ||
    surface === "job"
  ) {
    return surface;
  }
  return undefined;
}

function contextFrom(input: SurfaceCollectInput): SurfaceVerifierContext {
  return {
    env: {
      id: input.env.id,
      tier: input.env.tier,
      vars: () => input.env.vars(),
    },
    attemptId: input.attemptId,
    checkVersion: 1,
    artifactDigest: input.commitSha,
  };
}

function aggregate(checkId: string, results: readonly DomainSurfaceCheckResult[]): SurfaceCheckResult {
  const logText = results
    .map((result) => result.message)
    .filter((message): message is string => message !== undefined)
    .join("\n");
  return {
    checkId,
    observed: results.map((result) => ({
      checkId: result.check_id,
      status: result.status,
      receipt: result.receipt,
    })),
    hasObserved: results.length > 0,
    reporterStatus: reporterStatusOf(results),
    signals: signalsFor(results),
    trace: new Uint8Array(),
    log: new TextEncoder().encode(logText),
  };
}

function reporterStatusOf(results: readonly DomainSurfaceCheckResult[]): SurfaceCheckResult["reporterStatus"] {
  if (results.length === 0) return "error";
  if (results.some((result) => result.status === "error")) return "error";
  if (results.some((result) => result.status === "fail" || result.status === "missing")) return "fail";
  if (results.every((result) => result.status === "skip")) return "skip";
  return "pass";
}

function signalsFor(results: readonly DomainSurfaceCheckResult[]): RunSignals | null {
  if (results.some((result) => result.attribution === "environment")) {
    return { environmentFailure: "service_crash" };
  }
  const mismatch = results.find((result) => result.attribution === "contract_mismatch");
  if (mismatch) {
    return mismatch.message === undefined
      ? { contractMismatch: true }
      : { contractMismatch: true, plainMessage: mismatch.message };
  }
  if (results.some((result) => result.attribution === "binding_defect")) {
    return { bindingDefect: true };
  }
  return null;
}
