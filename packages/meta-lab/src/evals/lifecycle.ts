import { InvalidLifecycleTransitionError, UnknownArtifactError } from "./errors.js";
import type { ArtifactLifecycleState, ArtifactRecord, LifecycleRegistrySnapshot } from "./types.js";

const ALLOWED: Record<ArtifactLifecycleState, readonly ArtifactLifecycleState[]> = {
  draft: ["evaluated"],
  evaluated: ["active"],
  active: ["deprecated"],
  deprecated: ["active"],
};

export class ArtifactLifecycleManager {
  private readonly artifacts = new Map<string, ArtifactRecord>();

  constructor(initial?: readonly ArtifactRecord[]) {
    for (const row of initial ?? []) {
      this.artifacts.set(row.id, { ...row });
    }
  }

  get(id: string): ArtifactRecord {
    const row = this.artifacts.get(id);
    if (!row) throw new UnknownArtifactError(id);
    return { ...row };
  }

  snapshot(): LifecycleRegistrySnapshot {
    return {
      artifacts: [...this.artifacts.values()].map((row) => ({ ...row })),
    };
  }

  transition(id: string, to: ArtifactLifecycleState, evalRunId?: string): ArtifactRecord {
    const current = this.get(id);
    const allowed = ALLOWED[current.state];
    if (!allowed.includes(to)) {
      throw new InvalidLifecycleTransitionError(current.state, to);
    }
    let rollbackPointer = current.rollbackPointer;
    if (to === "active") {
      const priorActive = [...this.artifacts.values()].find(
        (row) => row.id !== id && row.state === "active",
      );
      if (priorActive) {
        this.artifacts.set(priorActive.id, { ...priorActive, state: "deprecated" });
        rollbackPointer = priorActive.version;
      }
    }
    const next: ArtifactRecord = {
      ...current,
      state: to,
      ...(rollbackPointer !== undefined ? { rollbackPointer } : {}),
      ...(evalRunId !== undefined
        ? { evalRunId }
        : current.evalRunId !== undefined
          ? { evalRunId: current.evalRunId }
          : {}),
    };
    this.artifacts.set(id, next);
    return { ...next };
  }

  registerDraft(id: string, version: string): ArtifactRecord {
    const row: ArtifactRecord = { id, version, state: "draft" };
    this.artifacts.set(id, row);
    return { ...row };
  }

  rollback(id: string): { promoted: ArtifactRecord; demoted: ArtifactRecord } {
    const current = this.get(id);
    if (current.state !== "active" || !current.rollbackPointer) {
      throw new InvalidLifecycleTransitionError(current.state, "rollback");
    }
    const prior = [...this.artifacts.values()].find(
      (row) => row.version === current.rollbackPointer,
    );
    const priorId = prior?.id;
    if (!priorId) {
      throw new UnknownArtifactError(current.rollbackPointer);
    }
    const demoted = this.transition(id, "deprecated");
    const promoted = this.transition(priorId, "active", current.evalRunId);
    return { promoted, demoted };
  }
}