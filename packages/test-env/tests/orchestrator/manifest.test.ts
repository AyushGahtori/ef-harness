import { describe, expect, it } from "vitest";
import {
  EnvironmentManifestSchema,
  ManifestValidationError,
  MissingEnvironmentSecretError,
  selectProvisioningTier,
} from "../../src/orchestrator/index.js";
import { createHarness } from "./support.js";

const SPEC_MANIFEST = `
# environment manifest (Phase 0, P0.6)
services: [postgres, redis, mail, oauth]
app:
  start: pnpm dev
  ready: http GET /api/health == 200
env:
  PORT: "{port.app}"
  APP_URL: "http://{host}:{port.app}"
  NEXTAUTH_URL: "http://{host}:{port.app}"
  DATABASE_URL: "postgres://app:{secret.pg}@127.0.0.1:{port.pg}/{db.name}"
  REDIS_URL: "redis://127.0.0.1:{port.redis}/0"
  SMTP_URL: "smtp://127.0.0.1:{port.smtp}"
  OAUTH_ISSUER: "http://127.0.0.1:{port.oauth}/{env.id}"
`;

describe("environment manifest", () => {
  it("parses the Phase 0 manifest, extra services, and tier", () => {
    const manifest = EnvironmentManifestSchema.parse(`
${SPEC_MANIFEST}
tier: 2
extraServices:
  worker:
    start: pnpm worker
    ready: tcp
    memoryCeilingMb: 128
`);
    expect(manifest.services).toEqual(["postgres", "redis", "mail", "oauth"]);
    expect(manifest.app).toEqual({ start: "pnpm dev", ready: "http GET /api/health == 200" });
    expect(manifest.env.DATABASE_URL).toContain("{secret.pg}");
    expect(manifest.env.OAUTH_ISSUER).toContain("{env.id}");
    expect(manifest.tier).toBe(2);
    expect(manifest.extraServices?.worker?.ready).toBe("tcp");
    expect(manifest.extraServices?.worker?.memoryCeilingMb).toBe(128);
  });

  it("accepts a block list of services", () => {
    const manifest = EnvironmentManifestSchema.parse(`
services:
  - sqlite
  - s3
  - http_replay
  - stripe
`);
    expect(manifest.services).toEqual(["sqlite", "s3", "http_replay", "stripe"]);
  });

  it("rejects an unknown service and a missing app command", () => {
    expect(() => EnvironmentManifestSchema.parse("services: [docker]")).toThrow(
      ManifestValidationError,
    );
    expect(() =>
      EnvironmentManifestSchema.parse(`
services: []
app:
  ready: tcp
`),
    ).toThrow(/app.start/);
  });

  it("selects the least expensive tier and lets an explicit tier suppress shared servers", () => {
    expect(selectProvisioningTier({ kind: "attempt", services: [], hasApp: false })).toBe(0);
    expect(selectProvisioningTier({ kind: "attempt", services: ["sqlite"], hasApp: false })).toBe(
      1,
    );
    expect(
      selectProvisioningTier({ kind: "attempt", services: ["postgres", "mail"], hasApp: true }),
    ).toBe(2);
    expect(
      selectProvisioningTier({ kind: "migration", services: ["postgres"], hasApp: false }),
    ).toBe(3);
    expect(
      selectProvisioningTier({
        kind: "attempt",
        services: ["postgres", "mail"],
        hasApp: false,
        explicitTier: 0,
      }),
    ).toBe(0);
  });

  it("fails create when a secret placeholder is not configured and rolls the lease back", async () => {
    const harness = await createHarness({ secrets: {} });
    try {
      await expect(
        harness.orchestrator.create(
          "attempt",
          `
services: [postgres]
env:
  DATABASE_URL: "postgres://app:{secret.MISSING}@127.0.0.1:{port.pg}/{db.name}"
`,
          "abc123",
          harness.worktree,
        ),
      ).rejects.toBeInstanceOf(MissingEnvironmentSecretError);
      expect(harness.portLeases.list()).toEqual([]);
      expect(harness.providers.get("postgres")?.provisions).toHaveLength(0);
      expect(harness.globalText()).not.toContain("MISSING");
    } finally {
      await harness.cleanup();
    }
  });
});
