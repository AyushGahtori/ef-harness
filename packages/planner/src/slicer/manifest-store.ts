import { DatabaseSync } from "node:sqlite";
import type { BriefManifest } from "./types.js";

export class BriefManifestStore {
  constructor(private readonly db: DatabaseSync) {}

  save(manifest: BriefManifest): void {
    const attemptId = manifest.attemptId ?? manifest.taskId;
    this.db
      .prepare(
        `INSERT INTO slicer_brief_manifests (attempt_id, task_id, level, brief_text, manifest_json, slice_sha256)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id) DO UPDATE SET
           task_id = excluded.task_id,
           level = excluded.level,
           brief_text = excluded.brief_text,
           manifest_json = excluded.manifest_json,
           slice_sha256 = excluded.slice_sha256`,
      )
      .run(attemptId, manifest.taskId, manifest.level, manifest.briefText, JSON.stringify(manifest), manifest.sliceSha256);
    const insertRead = this.db.prepare(
      `INSERT INTO read_sets (attempt, node, version, hash, how)
       VALUES (?, ?, ?, ?, 'pushed')
       ON CONFLICT(attempt, node, version) DO UPDATE SET hash = excluded.hash, how = excluded.how`,
    );
    for (const id of manifest.includedNodeIds) {
      const version = manifest.nodeVersions[id];
      const hash = manifest.nodeHashes[id];
      if (version === undefined || hash === undefined) continue;
      insertRead.run(attemptId, id, version, hash);
    }
  }

  read(attemptId: string): BriefManifest | null {
    const row = this.db
      .prepare(`SELECT manifest_json FROM slicer_brief_manifests WHERE attempt_id = ?`)
      .get(attemptId) as { manifest_json?: string } | undefined;
    if (!row?.manifest_json) return null;
    const parsed: unknown = JSON.parse(row.manifest_json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as BriefManifest;
  }
}
