import { ARTIFACT_TYPES, type ArtifactType } from "./constants.js";
import { HandoffDatabase } from "./database.js";
import {
  CasIntegrityError,
  HandoffNotFoundError,
  ImmutableHandoffError,
  PinMismatchError,
  SchemaValidationError,
  UnverifiedSliceError,
} from "./errors.js";
import { sha256Hex } from "./json.js";
import { assertCanonicalRole, assertCommitSha, assertSliceSha, type CasBlobStorePort, type SlicePinPort } from "./ports.js";
import type {
  ActiveAttempt,
  BindAttemptInput,
  HandoffArtifact,
  HandoffWake,
  PutHandoffInput,
  SupersedeHandoffInput,
} from "./types.js";

const ARTIFACT_TYPE_SET = new Set<string>(ARTIFACT_TYPES);

export class ArtifactHandoffStore {
  constructor(
    private readonly db: HandoffDatabase,
    private readonly cas: CasBlobStorePort,
    private readonly slices: SlicePinPort,
    private readonly now: () => number,
  ) {}

  put(input: PutHandoffInput): HandoffArtifact {
    return this.db.transaction(() => this.write(input, input.priorHandoffId ?? null, null));
  }

  supersede(
    previousId: string,
    input: SupersedeHandoffInput,
  ): { artifact: HandoffArtifact; wakes: readonly HandoffWake[] } {
    return this.db.transaction(() => {
      const previous = this.require(previousId);
      if (previous.supersededBy !== null) throw new ImmutableHandoffError(previousId);
      const artifact = this.write(input, previousId, previousId);
      this.db.stampSupersededBy(previousId, artifact.handoffId);
      const createdAt = this.now();
      const wakes: HandoffWake[] = [];
      for (const taskId of this.db.listWatchers(previousId)) {
        const wake: HandoffWake = {
          wakeId: this.db.nextId("HW-"),
          taskId,
          previousHandoffId: previousId,
          freshHandoffId: artifact.handoffId,
          freshPinnedBaseCommitSha: artifact.pinnedBaseCommitSha,
          freshPinnedSliceSha256: artifact.pinnedSliceSha256,
          createdAt,
        };
        this.db.insertHandoffWake(wake);
        wakes.push(wake);
      }
      return { artifact, wakes };
    });
  }

  watch(handoffId: string, taskId: string): void {
    this.require(handoffId);
    assertNode(taskId, "taskId");
    this.db.watchHandoff(handoffId, taskId, this.now());
  }

  bindAttempt(input: BindAttemptInput): ActiveAttempt {
    return this.db.transaction(() => {
      const handoff = this.require(input.handoffId);
      assertCommitSha(input.pinnedBaseCommitSha);
      assertSliceSha(input.pinnedSliceSha256);
      if (
        input.pinnedBaseCommitSha !== handoff.pinnedBaseCommitSha ||
        input.pinnedSliceSha256 !== handoff.pinnedSliceSha256
      ) {
        throw new PinMismatchError(input.attemptId, input.handoffId);
      }
      assertCanonicalRole(input.role);
      assertNode(input.taskId, "taskId");
      assertNode(input.workerId, "workerId");
      assertNode(input.attemptId, "attemptId");
      const attempt: ActiveAttempt = {
        attemptId: input.attemptId,
        taskId: input.taskId,
        role: input.role,
        workerId: input.workerId,
        pinnedBaseCommitSha: handoff.pinnedBaseCommitSha,
        pinnedSliceSha256: handoff.pinnedSliceSha256,
        boundHandoffId: handoff.handoffId,
        createdAt: this.now(),
      };
      this.db.insertAttempt(attempt);
      return attempt;
    });
  }

  get(handoffId: string): HandoffArtifact | null {
    return this.db.getArtifact(handoffId);
  }

  require(handoffId: string): HandoffArtifact {
    const found = this.db.getArtifact(handoffId);
    if (!found) throw new HandoffNotFoundError(handoffId);
    return found;
  }

  list(): readonly HandoffArtifact[] {
    return this.db.listArtifacts();
  }

  readBlob(hash: string): Uint8Array {
    return this.cas.getBlob(hash, "evidence");
  }

  wakes(taskId: string | null = null): readonly HandoffWake[] {
    return this.db.listHandoffWakes(taskId);
  }

  private write(
    input: PutHandoffInput | SupersedeHandoffInput,
    prior: string | null,
    supersedes: string | null,
  ): HandoffArtifact {
    assertNode(input.handoffId, "handoffId");
    assertCanonicalRole(input.fromRole);
    assertCanonicalRole(input.toRole);
    assertNode(input.fromTaskId, "fromTaskId");
    assertNode(input.toTaskId, "toTaskId");
    if (!ARTIFACT_TYPE_SET.has(input.artifactType)) {
      throw new SchemaValidationError(`artifactType ${String(input.artifactType)} is not a handoff artifact.`);
    }
    if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
      throw new SchemaValidationError("schemaVersion must be a positive integer.");
    }
    assertCommitSha(input.pinnedBaseCommitSha);
    assertSliceSha(input.pinnedSliceSha256);
    if (!this.slices.verify(input.pinnedSliceSha256)) throw new UnverifiedSliceError(input.pinnedSliceSha256);
    if (this.db.getArtifact(input.handoffId)) throw new ImmutableHandoffError(input.handoffId);
    if (prior !== null && !this.db.getArtifact(prior)) throw new HandoffNotFoundError(prior);
    if (!(input.payload instanceof Uint8Array)) throw new SchemaValidationError("payload must be bytes.");
    const payload = new Uint8Array(input.payload);
    const digest = sha256Hex(payload);
    const stored = this.cas.putBlob(payload, {
      holderKind: "project",
      holderId: input.fromTaskId,
      retention: "evidence",
    });
    if (stored.hash !== digest) throw new CasIntegrityError(stored.hash);
    const artifact: HandoffArtifact = {
      handoffId: input.handoffId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      fromTaskId: input.fromTaskId,
      toTaskId: input.toTaskId,
      artifactType: input.artifactType as ArtifactType,
      pinnedBaseCommitSha: input.pinnedBaseCommitSha,
      pinnedSliceSha256: input.pinnedSliceSha256,
      schemaVersion: input.schemaVersion,
      summary: input.summary,
      blobSha256: stored.hash,
      blobBytes: payload.byteLength,
      priorHandoffId: prior,
      supersedes,
      supersededBy: null,
      createdAt: this.now(),
    };
    this.db.insertArtifact(artifact);
    return artifact;
  }
}

function assertNode(value: string, label: string): void {
  if (value.trim().length === 0 || /\s/.test(value) || /^\d+$/.test(value)) {
    throw new SchemaValidationError(`${label} must be a non-empty canonical id.`);
  }
}
