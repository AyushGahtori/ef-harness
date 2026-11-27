import { describe, expect, it } from "vitest";
import {
  AttemptCheckpointSchema,
  AttemptCheckpointV0Schema,
  CheckOutcomeSchema,
  CheckpointUpcasterRegistry,
  VerificationReceiptSchema,
  WorkerEventSchema,
  checkpointV0ToV1,
  readCheckpoint,
} from "../../src/packets/index.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

const v0 = {
  format_version: 0 as const,
  attempt: "attempt-1",
  step: 4,
  wip_ref: "refs/harness/checkpoints/attempt-1/4",
  session_ref: "thread-9",
  contract_versions: { "kitchen-totals": 1 },
  pending_effects: [
    {
      id: "EF-1",
      kind: "migration",
      target: "state.db",
      payload_hash: "sha256:abc",
      idempotency_key: "mig-1",
      state: "intended" as const,
    },
  ],
  handoff_artifact: null,
  updated_at: 1_763_280_000_000,
};

describe("checkpoint upcasters", () => {
  it("upgrades a frozen v0 checkpoint to v1 without mutating the source", () => {
    const source = deepFreeze(structuredClone(v0));
    const before = structuredClone(source);
    const read = readCheckpoint(source);
    expect(read.format_version).toBe(1);
    expect(read.prompt_versions).toEqual({});
    expect(read.skill_digests).toEqual({});
    expect(read.contract_versions).toEqual({ "kitchen-totals": 1 });
    expect(read.pending_effects).toEqual(v0.pending_effects);
    expect(read.wip_ref).toBe(v0.wip_ref);
    expect(source).toEqual(before);
    expect(read).not.toBe(source);
    expect(AttemptCheckpointV0Schema.parse(source).format_version).toBe(0);
  });

  it("reads a v1 checkpoint by cloning it", () => {
    const source = deepFreeze({
      ...readCheckpoint(v0),
      prompt_versions: { "leaf-worker@1": "1" },
      skill_digests: { "accessible-ui": "sha256:abc" },
    });
    const before = structuredClone(source);
    const read = readCheckpoint(source);
    expect(read).toEqual(source);
    expect(read).not.toBe(source);
    expect(source).toEqual(before);
    expect(AttemptCheckpointSchema.parse(read).format_version).toBe(1);
  });

  it("chains a registered v1 to v2 upcaster without rewriting the stored v0 object", () => {
    const registry = new CheckpointUpcasterRegistry();
    registry.register(checkpointV0ToV1);
    registry.register({
      fromVersion: 1,
      toVersion: 2,
      upcast(source) {
        const current = AttemptCheckpointSchema.parse(source);
        return { ...current, format_version: 2, resume_count: 0 };
      },
    });
    const source = deepFreeze(structuredClone(v0));
    const before = structuredClone(source);
    const upgraded = registry.upcast(source, 2) as { format_version: number; resume_count: number };
    expect(upgraded.format_version).toBe(2);
    expect(upgraded.resume_count).toBe(0);
    expect(source).toEqual(before);
    expect(upgraded).not.toBe(source);
  });
});

describe("receipts and worker events", () => {
  it("accepts a sandboxed receipt and rejects an unsandboxed receipt that still names a tier", () => {
    const receipt = {
      schema: "verification-receipt@1",
      id: "VR-7781",
      task: "T07",
      attempt: "attempt-1",
      artifact_digest: "sha256:abc",
      checks: [
        {
          check_id: "AC-31",
          check_version: 2,
          artifact_digest: "sha256:abc",
          status: "pass",
          collected_count: 4,
        },
        {
          check_id: "UI-12",
          check_version: 1,
          artifact_digest: "sha256:abc",
          status: "skip",
          collected_count: 0,
        },
      ],
      counts: { pass: 1, fail: 0, skip: 1, missing: 0, error: 0 },
      sandbox: { tier: "A", unsandboxed: false },
      static_audit: {
        schema: "static-audit@1",
        artifact_digest: "sha256:abc",
        coverage_mode: "full",
        hard: [],
        soft: [
          {
            rule_id: "special_casing",
            file: "src/app/kitchen/page.tsx",
            line: 12,
            message: "Several branches compare literal sample values.",
          },
        ],
        sandbox: { tier: "A", unsandboxed: false },
      },
    };
    expect(VerificationReceiptSchema.parse(receipt).id).toBe("VR-7781");
    expect(
      VerificationReceiptSchema.safeParse({
        ...receipt,
        sandbox: { tier: "C", unsandboxed: true },
        static_audit: undefined,
      }).success,
    ).toBe(false);
    expect(
      VerificationReceiptSchema.safeParse({
        ...receipt,
        static_audit: undefined,
        sandbox: { tier: null, unsandboxed: true },
        counts: { pass: 2, fail: 0, skip: 0, missing: 0, error: 0 },
      }).success,
    ).toBe(false);
    expect(CheckOutcomeSchema.safeParse({ status: "pass", collected_count: 0 }).success).toBe(false);
    expect(
      CheckOutcomeSchema.safeParse({
        check_id: "AC-31",
        check_version: 2,
        artifact_digest: "sha256:abc",
        status: "pass",
        collected_count: 0,
      }).success,
    ).toBe(false);
    expect(
      VerificationReceiptSchema.safeParse({
        ...receipt,
        checks: [
          {
            check_id: "AC-31",
            check_version: 2,
            artifact_digest: "sha256:abc",
            status: "pass",
            collected_count: 0,
          },
        ],
        counts: { pass: 1, fail: 0, skip: 0, missing: 0, error: 0 },
        static_audit: undefined,
      }).success,
    ).toBe(false);
  });

  it("accepts a normalized worker event and rejects a fractional usage cost", () => {
    expect(
      WorkerEventSchema.parse({
        schema: "worker-event@1",
        type: "usage",
        tokens: 12000,
        cost_micro_usd: 40_000,
      }),
    ).toMatchObject({ type: "usage", tokens: 12000 });
    expect(
      WorkerEventSchema.safeParse({
        schema: "worker-event@1",
        type: "usage",
        tokens: 12.5,
      }).success,
    ).toBe(false);
    expect(
      WorkerEventSchema.parse({
        schema: "worker-event@1",
        type: "tool.requested",
        kind: "shell",
        args: { cmd: "pnpm test" },
      }).type,
    ).toBe("tool.requested");
  });
});
