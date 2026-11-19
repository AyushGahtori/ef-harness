import type { DatabaseSync } from "node:sqlite";

import { replaceVariants } from "./redact.js";
import { sqlInteger, sqlNullableText, sqlText } from "./sqlite-util.js";
import type { ComputeNodeContentHash, SecretVariant } from "./types.js";
import {
  assertNodesVersionGuardActive,
  dropNodesVersionGuard,
  restoreNodesVersionGuard,
} from "./version-guard.js";
import type { TouchedNode } from "./search-maintenance.js";

export interface RewriteResult {
  readonly counts: Record<string, number>;
  readonly hashMap: Record<string, string>;
  readonly touchedNodes: readonly TouchedNode[];
  readonly stateRowsTouched: number;
}

interface VariantScan {
  readonly variants: readonly SecretVariant[];
  readonly placeholder: string;
  readonly hashContent: ComputeNodeContentHash;
}

export function rewriteDatabaseSecret(
  db: DatabaseSync,
  scan: VariantScan,
): RewriteResult {
  const counts: Record<string, number> = {
    nodes: 0,
    node_versions: 0,
    turns: 0,
    evidence: 0,
    outbox: 0,
    change_sets: 0,
    candidates: 0,
    inbox_items: 0,
    turn_log: 0,
  };
  const hashMap: Record<string, string> = {};
  const touchedNodes: TouchedNode[] = [];
  const nodeIds = collect(db, "SELECT id AS ref FROM nodes WHERE instr(title, :secret) > 0 OR instr(text, :secret) > 0 OR instr(fields, :secret) > 0", scan.variants);
  const versionRefs = collect(
    db,
    "SELECT id || '@' || version AS ref FROM node_versions WHERE instr(title, :secret) > 0 OR instr(text, :secret) > 0 OR instr(fields, :secret) > 0",
    scan.variants,
  );
  const turnIds = collect(db, "SELECT id AS ref FROM turns WHERE instr(text, :secret) > 0 OR instr(coalesce(target,''), :secret) > 0 OR instr(coalesce(audio_artifact,''), :secret) > 0", scan.variants);
  const evidenceIds = collect(db, "SELECT CAST(id AS TEXT) AS ref FROM evidence WHERE instr(quote, :secret) > 0", scan.variants);
  const outboxIds = collect(db, "SELECT id AS ref FROM outbox WHERE instr(payload, :secret) > 0", scan.variants);
  const changeSetIds = collect(
    db,
    "SELECT id AS ref FROM change_sets WHERE instr(coalesce(summary,'') || coalesce(origin_ref,''), :secret) > 0",
    scan.variants,
  );
  const candidateIds = collect(db, "SELECT id AS ref FROM candidates WHERE instr(payload, :secret) > 0", scan.variants);
  const inboxIds = collect(db, "SELECT id AS ref FROM inbox_items WHERE instr(payload, :secret) > 0", scan.variants);
  const turnLogRefs = collect(
    db,
    `SELECT attempt || ':' || step AS ref FROM turn_log
      WHERE instr(coalesce(result_summary,''), :secret) > 0
         OR instr(coalesce(tool_call,''), :secret) > 0
         OR instr(coalesce(request_digest,''), :secret) > 0
         OR instr(coalesce(items_artifact,''), :secret) > 0
         OR instr(coalesce(result_artifact,''), :secret) > 0
         OR instr(coalesce(checkpoint_commit,''), :secret) > 0`,
    scan.variants,
  );
  const stateRowsTouched =
    nodeIds.size +
    versionRefs.size +
    turnIds.size +
    evidenceIds.size +
    outboxIds.size +
    changeSetIds.size +
    candidateIds.size +
    inboxIds.size +
    turnLogRefs.size;
  if (stateRowsTouched === 0) {
    return { counts, hashMap, touchedNodes, stateRowsTouched };
  }
  if (db.isTransaction) {
    throw new Error("sanctioned history rewrite must start in autocommit");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    dropNodesVersionGuard(db);
    counts["nodes"] = rewriteNodes(db, nodeIds, scan, hashMap, touchedNodes);
    counts["node_versions"] = rewriteNodeVersions(db, versionRefs, scan, hashMap);
    counts["turns"] = rewriteTurns(db, turnIds, scan);
    counts["evidence"] = rewriteEvidence(db, evidenceIds, scan);
    counts["outbox"] = rewriteJsonColumn(db, "outbox", "id", "payload", outboxIds, scan);
    counts["change_sets"] = rewriteChangeSets(db, changeSetIds, scan);
    counts["candidates"] = rewriteJsonColumn(db, "candidates", "id", "payload", candidateIds, scan);
    counts["inbox_items"] = rewriteJsonColumn(db, "inbox_items", "id", "payload", inboxIds, scan);
    counts["turn_log"] = rewriteTurnLog(db, turnLogRefs, scan);
    restoreNodesVersionGuard(db);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
  assertNodesVersionGuardActive(db);
  return { counts, hashMap, touchedNodes, stateRowsTouched };
}

function collect(db: DatabaseSync, sql: string, variants: readonly SecretVariant[]): Set<string> {
  const refs = new Set<string>();
  const statement = db.prepare(sql);
  for (const variant of variants) {
    for (const row of statement.all({ secret: variant.value })) {
      const ref = sqlText(row["ref"]);
      if (ref) refs.add(ref);
    }
  }
  return refs;
}

function rememberHash(hashMap: Record<string, string>, oldHash: string, newHash: string): void {
  if (oldHash === newHash) return;
  const existing = hashMap[oldHash];
  if (existing !== undefined && existing !== newHash) {
    throw new Error("content hash map collision during sanctioned history rewrite");
  }
  hashMap[oldHash] = newHash;
}

function assertJsonText(text: string, table: string): void {
  try {
    JSON.parse(text);
  } catch {
    throw new Error(`redaction broke JSON validity in ${table}`);
  }
}

function rewriteNodes(
  db: DatabaseSync,
  ids: ReadonlySet<string>,
  scan: VariantScan,
  hashMap: Record<string, string>,
  touched: TouchedNode[],
): number {
  const select = db.prepare(
    "SELECT nid, id, kind, version, content_hash, title, text, fields, status FROM nodes WHERE id = ?",
  );
  const update = db.prepare(
    "UPDATE nodes SET title = ?, text = ?, fields = ?, content_hash = ? WHERE id = ?",
  );
  let changed = 0;
  for (const id of ids) {
    const row = select.get(id);
    if (!row) continue;
    const title = replaceVariants(sqlText(row["title"]), scan.variants, scan.placeholder);
    const text = replaceVariants(sqlText(row["text"]), scan.variants, scan.placeholder);
    const fields = replaceVariants(sqlText(row["fields"]), scan.variants, scan.placeholder);
    if (!title.replaced && !text.replaced && !fields.replaced) continue;
    if (fields.replaced) assertJsonText(fields.text, "nodes");
    const kind = sqlText(row["kind"]);
    const oldHash = sqlText(row["content_hash"]);
    const newHash = scan.hashContent({ kind, title: title.text, text: text.text, fields: fields.text });
    update.run(title.text, text.text, fields.text, newHash, id);
    rememberHash(hashMap, oldHash, newHash);
    const status = sqlText(row["status"]);
    db.prepare("DELETE FROM names WHERE owner_node = ?").run(id);
    db.prepare(
      `INSERT INTO names(kind, value, owner_node, feature)
       SELECT j.value ->> '$.kind', j.value ->> '$.value', ?, json_extract(?, '$.feature')
         FROM json_each(?, '$.names') AS j
        WHERE ? = 'active'`,
    ).run(id, fields.text, fields.text, status);
    touched.push({
      nid: sqlInteger(row["nid"], "nid"),
      id,
      previousTitle: sqlText(row["title"]),
      title: title.text,
      text: text.text,
      fields: fields.text,
    });
    changed += 1;
  }
  return changed;
}

function rewriteNodeVersions(
  db: DatabaseSync,
  refs: ReadonlySet<string>,
  scan: VariantScan,
  hashMap: Record<string, string>,
): number {
  const select = db.prepare(
    "SELECT id, version, kind, content_hash, title, text, fields FROM node_versions WHERE id = ? AND version = ?",
  );
  const update = db.prepare(
    "UPDATE node_versions SET title = ?, text = ?, fields = ?, content_hash = ? WHERE id = ? AND version = ?",
  );
  let changed = 0;
  for (const ref of refs) {
    const at = ref.lastIndexOf("@");
    if (at <= 0) continue;
    const id = ref.slice(0, at);
    const version = Number(ref.slice(at + 1));
    const row = select.get(id, version);
    if (!row) continue;
    const title = replaceVariants(sqlText(row["title"]), scan.variants, scan.placeholder);
    const text = replaceVariants(sqlText(row["text"]), scan.variants, scan.placeholder);
    const fields = replaceVariants(sqlText(row["fields"]), scan.variants, scan.placeholder);
    if (!title.replaced && !text.replaced && !fields.replaced) continue;
    if (fields.replaced) assertJsonText(fields.text, "node_versions");
    const newHash = scan.hashContent({
      kind: sqlText(row["kind"]),
      title: title.text,
      text: text.text,
      fields: fields.text,
    });
    const oldHash = sqlText(row["content_hash"]);
    update.run(title.text, text.text, fields.text, newHash, id, version);
    rememberHash(hashMap, oldHash, newHash);
    changed += 1;
  }
  return changed;
}

function rewriteTurns(db: DatabaseSync, ids: ReadonlySet<string>, scan: VariantScan): number {
  const select = db.prepare("SELECT id, target, text, audio_artifact FROM turns WHERE id = ?");
  const update = db.prepare(
    "UPDATE turns SET target = ?, text = ?, audio_artifact = ?, redacted = 1 WHERE id = ?",
  );
  let changed = 0;
  for (const id of ids) {
    const row = select.get(id);
    if (!row) continue;
    const target = redactNullable(sqlNullableText(row["target"]), scan);
    const text = replaceVariants(sqlText(row["text"]), scan.variants, scan.placeholder);
    const audio = redactNullable(sqlNullableText(row["audio_artifact"]), scan);
    if (!target.replaced && !text.replaced && !audio.replaced) continue;
    update.run(target.text, text.text, audio.text, id);
    changed += 1;
  }
  return changed;
}

function rewriteEvidence(db: DatabaseSync, ids: ReadonlySet<string>, scan: VariantScan): number {
  const select = db.prepare("SELECT id, quote FROM evidence WHERE id = ?");
  const update = db.prepare("UPDATE evidence SET quote = ? WHERE id = ?");
  let changed = 0;
  for (const id of ids) {
    const row = select.get(id);
    if (!row) continue;
    const quote = replaceVariants(sqlText(row["quote"]), scan.variants, scan.placeholder);
    if (!quote.replaced) continue;
    update.run(quote.text, Number(id));
    changed += 1;
  }
  return changed;
}

function rewriteJsonColumn(
  db: DatabaseSync,
  table: "outbox" | "candidates" | "inbox_items",
  key: "id",
  column: "payload",
  ids: ReadonlySet<string>,
  scan: VariantScan,
): number {
  const select = db.prepare(`SELECT ${key} AS id, ${column} AS payload FROM ${table} WHERE ${key} = ?`);
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`);
  let changed = 0;
  for (const id of ids) {
    const row = select.get(id);
    if (!row) continue;
    const payload = replaceVariants(sqlText(row["payload"]), scan.variants, scan.placeholder);
    if (!payload.replaced) continue;
    assertJsonText(payload.text, table);
    update.run(payload.text, id);
    changed += 1;
  }
  return changed;
}

function rewriteChangeSets(db: DatabaseSync, ids: ReadonlySet<string>, scan: VariantScan): number {
  const select = db.prepare("SELECT id, summary, origin_ref FROM change_sets WHERE id = ?");
  const update = db.prepare("UPDATE change_sets SET summary = ?, origin_ref = ? WHERE id = ?");
  let changed = 0;
  for (const id of ids) {
    const row = select.get(id);
    if (!row) continue;
    const summary = redactNullable(sqlNullableText(row["summary"]), scan);
    const origin = redactNullable(sqlNullableText(row["origin_ref"]), scan);
    if (!summary.replaced && !origin.replaced) continue;
    update.run(summary.text, origin.text, id);
    changed += 1;
  }
  return changed;
}

function rewriteTurnLog(db: DatabaseSync, refs: ReadonlySet<string>, scan: VariantScan): number {
  const select = db.prepare(
    `SELECT attempt, step, request_digest, items_artifact, tool_call, result_summary, result_artifact, checkpoint_commit
       FROM turn_log WHERE attempt = ? AND step = ?`,
  );
  const update = db.prepare(
    `UPDATE turn_log
        SET request_digest = ?, items_artifact = ?, tool_call = ?, result_summary = ?,
            result_artifact = ?, checkpoint_commit = ?
      WHERE attempt = ? AND step = ?`,
  );
  let changed = 0;
  for (const ref of refs) {
    const at = ref.lastIndexOf(":");
    if (at <= 0) continue;
    const attempt = ref.slice(0, at);
    const step = Number(ref.slice(at + 1));
    const row = select.get(attempt, step);
    if (!row) continue;
    const columns = [
      "request_digest",
      "items_artifact",
      "tool_call",
      "result_summary",
      "result_artifact",
      "checkpoint_commit",
    ] as const;
    const next = columns.map((column) => redactNullable(sqlNullableText(row[column]), scan));
    if (!next.some((item) => item.replaced)) continue;
    const requestDigest = next[0]?.text ?? null;
    const itemsArtifact = next[1]?.text ?? null;
    const toolCall = next[2]?.text ?? null;
    const resultSummary = next[3]?.text ?? null;
    const resultArtifact = next[4]?.text ?? null;
    const checkpointCommit = next[5]?.text ?? null;
    update.run(requestDigest, itemsArtifact, toolCall, resultSummary, resultArtifact, checkpointCommit, attempt, step);
    changed += 1;
  }
  return changed;
}

function redactNullable(
  value: string | null,
  scan: VariantScan,
): { readonly text: string | null; readonly replaced: boolean } {
  if (value === null) return { text: null, replaced: false };
  const redacted = replaceVariants(value, scan.variants, scan.placeholder);
  return { text: redacted.text, replaced: redacted.replaced };
}
