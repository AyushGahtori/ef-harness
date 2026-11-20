import { describe, expect, it } from "vitest";
import {
  ApiContractCheckSchema,
  AuthCallbackCheckSchema,
  BackgroundJobCheckSchema,
  CliSurfaceCheckSchema,
  ConcurrencyPerfCheckSchema,
  InboundWebhookCheckSchema,
  MigrationPreservationCheckSchema,
  RateLimitBurstCheckSchema,
  TimeBoundaryCheckSchema,
} from "../../src/surfaces/schemas.js";
import {
  CORE_SURFACE_VERIFIER_IDS,
  createDefaultSurfaceRegistry,
  createSurfaceVerifierRegistry,
  registerCoreSurfaceVerifiers,
} from "../../src/surfaces/registry.js";
import { toCheckResultRow } from "../../src/surfaces/result.js";
import { verifierContext } from "./support.js";

describe("surface verifier registry", () => {
  it("registers the seven core verifiers and the X-09 / X-14 verifiers on the same adapter contract", () => {
    const registry = createSurfaceVerifierRegistry();
    registerCoreSurfaceVerifiers(registry);
    expect(registry.list().map((adapter) => adapter.id)).toEqual([...CORE_SURFACE_VERIFIER_IDS]);
    const all = createDefaultSurfaceRegistry();
    expect(all.list().map((adapter) => adapter.id)).toEqual([
      ...CORE_SURFACE_VERIFIER_IDS,
      "inbound-webhook",
      "rate-limit-burst",
    ]);
    for (const adapter of all.list()) {
      expect(adapter.surface.length).toBeGreaterThan(0);
      expect(typeof adapter.verify).toBe("function");
    }
  });

  it("rejects an empty check spec for every published Zod schema", () => {
    for (const schema of [
      ApiContractCheckSchema,
      AuthCallbackCheckSchema,
      TimeBoundaryCheckSchema,
      BackgroundJobCheckSchema,
      CliSurfaceCheckSchema,
      ConcurrencyPerfCheckSchema,
      MigrationPreservationCheckSchema,
      InboundWebhookCheckSchema,
      RateLimitBurstCheckSchema,
    ]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it("maps a surface result onto a check_results row", () => {
    const context = verifierContext("http://127.0.0.1:9");
    const row = toCheckResultRow(
      {
        check_id: "api.orders:X-01",
        status: "pass",
        receipt: { recorded_at: context.recordedAt, rule: "X-01" },
      },
      context,
    );
    expect(row).toEqual({
      check_id: "api.orders:X-01",
      attempt: "attempt-063",
      check_version: 1,
      artifact_digest: "digest-063",
      status: "pass",
      receipt: JSON.stringify({ recorded_at: context.recordedAt, rule: "X-01" }),
      recorded_at: context.recordedAt,
    });
  });
});
