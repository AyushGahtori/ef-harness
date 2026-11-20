import path from "node:path";

import { FeaturePlanError } from "./errors.js";
import type { FeaturePlanDatabase, StoredHiddenCheck } from "./state-db.js";
import type { HeldBackCase } from "./types.js";

export interface ExportIntent {
  readonly algorithm: "age-x25519";
  readonly table: "hidden_checks";
  readonly cas: true;
  readonly encryptedAtRest: false;
  readonly note: "Task 186 encrypts sealed checks at export time";
}

/**
 * Sealed hidden-check pool. Bytes live in state.db.hidden_checks plus a CAS
 * blob. Workers and kb.* reads cannot see them. Export encryption is age
 * (Task 186); rows stay unencrypted until that export.
 */
export class HiddenCheckPoolStore {
  constructor(private readonly db: FeaturePlanDatabase) {}

  commit(cases: readonly HeldBackCase[], featureId: string, sealedAt: number): StoredHiddenCheck[] {
    return this.db.transaction(() => cases.map((item) => this.db.upsertHidden(item, featureId, sealedAt)));
  }

  readForCleanVerifier(id: string): HeldBackCase {
    const row = this.db.getHidden(id);
    if (!row || row.status !== "sealed") {
      throw new FeaturePlanError("worker_blind", `Hidden check ${id} is not sealed`, { id });
    }
    return JSON.parse(row.contentJson) as HeldBackCase;
  }

  /**
   * Worker and workspace reads are denied. Sealed bytes stay on the kernel
   * state path, which the worker sandbox is not allowed to open.
   */
  readAsWorker(requestedPath: string, worktree: string): never {
    throw new FeaturePlanError(
      "worker_blind",
      "Sealed checks live in state.db / kernel CAS outside the worker worktree",
      { requestedPath, worktree },
    );
  }

  kbGet(id: string): { found: false } | { found: true; id: string; title: string; text: string } {
    if (this.db.getHidden(id)) return { found: false };
    const node = this.db.getNode(id);
    if (!node || node.status !== "active") return { found: false };
    if (node.fields.visibility === "held_back" || node.fields.sealed === true) return { found: false };
    return { found: true, id: node.id, title: node.title, text: node.text };
  }

  kbSearch(query: string): { ids: string[] } {
    const needle = query.toLowerCase();
    const ids: string[] = [];
    for (const node of this.db.listNodes()) {
      if (node.status !== "active") continue;
      if (node.fields.visibility === "held_back" || node.fields.sealed === true) continue;
      const hay = `${node.id}\n${node.title}\n${node.text}`.toLowerCase();
      if (hay.includes(needle)) ids.push(node.id);
    }
    return { ids };
  }

  storagePath(id: string): string {
    return `kernel://state.db/hidden_checks/${id}`;
  }

  listForFeature(featureId: string): readonly StoredHiddenCheck[] {
    return this.db.listHidden(featureId).filter((row) => row.status === "sealed");
  }

  listForRequirements(requirementIds: readonly string[]): readonly StoredHiddenCheck[] {
    const allowed = new Set(requirementIds);
    return this.db.listHidden().filter((row) => row.status === "sealed" && allowed.has(row.requirementId));
  }

  exportIntent(): ExportIntent {
    return {
      algorithm: "age-x25519",
      table: "hidden_checks",
      cas: true,
      encryptedAtRest: false,
      note: "Task 186 encrypts sealed checks at export time",
    };
  }
}

export function sealedPathIsOutsideWorktree(storagePath: string, worktree: string): boolean {
  if (storagePath.startsWith("kernel://")) return true;
  const root = path.resolve(worktree);
  const target = path.resolve(storagePath);
  const relative = path.relative(root, target);
  return relative.startsWith("..") || path.isAbsolute(relative);
}
