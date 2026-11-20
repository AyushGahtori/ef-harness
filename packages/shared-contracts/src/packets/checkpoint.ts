import { z } from "zod/v4";
import {
  ARRAY_MAX_ITEMS,
  digestSchema,
  idSchema,
  nonNegativeIntSchema,
  unixMsSchema,
} from "./bounds.js";

export const EFFECT_STATES = [
  "intended",
  "approved",
  "sent",
  "confirmed",
  "failed",
  "unknown",
] as const;

export const PendingEffectSchema = z
  .object({
    id: idSchema,
    kind: idSchema,
    target: z.string().min(1).max(512),
    payload_hash: digestSchema,
    idempotency_key: z.string().min(1).max(256),
    state: z.enum(EFFECT_STATES),
  })
  .strict();

const versionMapSchema = z.record(z.string().min(1).max(128), z.string().min(1).max(64));
const contractVersionMapSchema = z.record(z.string().min(1).max(256), nonNegativeIntSchema);

export const CHECKPOINT_FORMAT_VERSION = 1 as const;

export const AttemptCheckpointSchema = z
  .object({
    format_version: z.literal(CHECKPOINT_FORMAT_VERSION),
    attempt: idSchema,
    step: nonNegativeIntSchema,
    wip_ref: z.string().min(1).max(512).nullable(),
    session_ref: z.string().min(1).max(256).nullable(),
    prompt_versions: versionMapSchema,
    skill_digests: versionMapSchema,
    contract_versions: contractVersionMapSchema,
    pending_effects: z.array(PendingEffectSchema).max(ARRAY_MAX_ITEMS),
    handoff_artifact: z.string().min(1).max(256).nullable(),
    updated_at: unixMsSchema,
  })
  .strict();

export const AttemptCheckpointV0Schema = z
  .object({
    format_version: z.literal(0),
    attempt: idSchema,
    step: nonNegativeIntSchema,
    wip_ref: z.string().min(1).max(512).nullable().optional(),
    session_ref: z.string().min(1).max(256).nullable().optional(),
    contract_versions: contractVersionMapSchema.optional(),
    pending_effects: z.array(PendingEffectSchema).max(ARRAY_MAX_ITEMS).optional(),
    handoff_artifact: z.string().min(1).max(256).nullable().optional(),
    updated_at: unixMsSchema,
  })
  .strict();

export interface CheckpointUpcaster {
  readonly fromVersion: number;
  readonly toVersion: number;
  upcast(source: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

export interface CheckpointRegistry {
  register(upcaster: CheckpointUpcaster): void;
  upcast(source: unknown, targetVersion?: number): unknown;
}

function readFormatVersion(value: Record<string, unknown>): number {
  const version = value.format_version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 0 ||
    Object.is(version, -0)
  ) {
    throw new Error("checkpoint format_version must be a nonnegative integer");
  }
  return version;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

export class CheckpointUpcasterRegistry implements CheckpointRegistry {
  private readonly byFrom = new Map<number, CheckpointUpcaster>();

  register(upcaster: CheckpointUpcaster): void {
    if (!Number.isInteger(upcaster.fromVersion) || !Number.isInteger(upcaster.toVersion)) {
      throw new Error("checkpoint upcaster versions must be integers");
    }
    if (upcaster.toVersion !== upcaster.fromVersion + 1) {
      throw new Error("checkpoint upcasters must advance exactly one format version");
    }
    if (this.byFrom.has(upcaster.fromVersion)) {
      throw new Error(`checkpoint upcaster already registered for format_version ${upcaster.fromVersion}`);
    }
    this.byFrom.set(upcaster.fromVersion, upcaster);
  }

  upcast(source: unknown, targetVersion: number = CHECKPOINT_FORMAT_VERSION): unknown {
    if (source === null || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("checkpoint must be an object");
    }
    const fingerprint = JSON.stringify(source);
    let current = cloneJson(source) as Record<string, unknown>;
    let steps = 0;
    while (readFormatVersion(current) < targetVersion) {
      const version = readFormatVersion(current);
      const upcaster = this.byFrom.get(version);
      if (!upcaster) {
        throw new Error(`no checkpoint upcaster registered from format_version ${version}`);
      }
      const next = upcaster.upcast(current);
      if (next === current || next === source) {
        throw new Error("checkpoint upcaster must return a new object");
      }
      current = next;
      steps += 1;
      if (steps > 32) {
        throw new Error("checkpoint upcaster chain exceeded 32 steps");
      }
    }
    if (readFormatVersion(current) !== targetVersion) {
      throw new Error(
        `checkpoint upcast stopped at format_version ${readFormatVersion(current)}, expected ${targetVersion}`,
      );
    }
    if (JSON.stringify(source) !== fingerprint) {
      throw new Error("checkpoint upcast mutated the source object");
    }
    return cloneJson(current);
  }
}

export const checkpointV0ToV1: CheckpointUpcaster = {
  fromVersion: 0,
  toVersion: 1,
  upcast(source) {
    const parsed = AttemptCheckpointV0Schema.parse(source);
    return {
      format_version: 1,
      attempt: parsed.attempt,
      step: parsed.step,
      wip_ref: parsed.wip_ref ?? null,
      session_ref: parsed.session_ref ?? null,
      prompt_versions: {},
      skill_digests: {},
      contract_versions: parsed.contract_versions ?? {},
      pending_effects: parsed.pending_effects ?? [],
      handoff_artifact: parsed.handoff_artifact ?? null,
      updated_at: parsed.updated_at,
    };
  },
};

export const defaultCheckpointUpcasters = new CheckpointUpcasterRegistry();
defaultCheckpointUpcasters.register(checkpointV0ToV1);

export function readCheckpoint(
  source: unknown,
  registry: CheckpointRegistry = defaultCheckpointUpcasters,
): AttemptCheckpoint {
  return AttemptCheckpointSchema.parse(registry.upcast(source, CHECKPOINT_FORMAT_VERSION));
}

export type PendingEffect = z.infer<typeof PendingEffectSchema>;
export type AttemptCheckpoint = z.infer<typeof AttemptCheckpointSchema>;
export type AttemptCheckpointV0 = z.infer<typeof AttemptCheckpointV0Schema>;
