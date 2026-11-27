import { ApiContractVerifier } from "./api-contract-verifier.js";
import { AuthCallbackVerifier } from "./auth-callback-verifier.js";
import { BackgroundJobVerifier } from "./background-job-verifier.js";
import { CliSurfaceVerifier } from "./cli-surface-verifier.js";
import { ConcurrencyPerfVerifier } from "./concurrency-perf-verifier.js";
import { InboundWebhookVerifier } from "./inbound-webhook-verifier.js";
import { MigrationPreservationVerifier } from "./migration-preservation-verifier.js";
import { RateLimitBurstVerifier } from "./rate-limit-burst-verifier.js";
import { TimeBoundaryVerifier } from "./time-boundary-verifier.js";
import type { SurfaceCheckVerifier, SurfaceVerifierRegistry } from "./types.js";

export const CORE_SURFACE_VERIFIER_IDS = [
  "api-contract",
  "auth-callback",
  "time-boundary",
  "background-job",
  "cli-surface",
  "concurrency-perf",
  "migration-preservation",
] as const;

export function createSurfaceVerifierRegistry(): SurfaceVerifierRegistry {
  const adapters: SurfaceCheckVerifier[] = [];
  return {
    register(adapter) {
      if (adapters.some((existing) => existing.id === adapter.id)) {
        throw new Error(`surface verifier ${adapter.id} is already registered`);
      }
      adapters.push(adapter);
    },
    list() {
      return [...adapters];
    },
  };
}

/** The seven non-UI surface verifiers consumed by CleanVerifierRunner. */
export function registerCoreSurfaceVerifiers(registry: SurfaceVerifierRegistry): void {
  registry.register(new ApiContractVerifier());
  registry.register(new AuthCallbackVerifier());
  registry.register(new TimeBoundaryVerifier());
  registry.register(new BackgroundJobVerifier());
  registry.register(new CliSurfaceVerifier());
  registry.register(new ConcurrencyPerfVerifier());
  registry.register(new MigrationPreservationVerifier());
}

/** X-09 and X-14 verifiers. They use the same adapter contract as the core seven. */
export function registerCrossCuttingSurfaceVerifiers(registry: SurfaceVerifierRegistry): void {
  registry.register(new InboundWebhookVerifier());
  registry.register(new RateLimitBurstVerifier());
}

export function createDefaultSurfaceRegistry(): SurfaceVerifierRegistry {
  const registry = createSurfaceVerifierRegistry();
  registerCoreSurfaceVerifiers(registry);
  registerCrossCuttingSurfaceVerifiers(registry);
  return registry;
}
