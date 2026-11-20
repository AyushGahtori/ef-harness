import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { computeNodeContentHash } from "./canonical-hash.js";
import { repositoryRoot } from "./engines.js";
import type { BrandAssetRole } from "./limits.js";
import { assetIdForRole, type BrandAssetStateStore, type StoredBrandAsset } from "./brand-record.js";

interface NodeIdentity {
  readonly version: number;
  readonly contentHash: string;
}

/**
 * Writes `kind = 'asset'` rows into state.db. The schema's node_kinds list has `asset`
 * and does not have a separate `brand_asset` kind. `fields.recordType` is `brand_asset`.
 */
export class SqliteBrandAssetState implements BrandAssetStateStore {
  private revision = 0;

  constructor(private readonly db: DatabaseSync) {}

  static open(filename = ":memory:"): SqliteBrandAssetState {
    const db = new DatabaseSync(filename);
    db.exec("PRAGMA foreign_keys = ON");
    db.function("ef_search_text", { deterministic: true }, (value: unknown) => splitSearchText(value));
    db.exec(readFileSync(path.join(repositoryRoot(), "schema", "state.sql"), "utf8"));
    return new SqliteBrandAssetState(db);
  }

  upsert(asset: StoredBrandAsset): void {
    const title = `Brand asset ${asset.role}`;
    const fields = {
      recordType: "brand_asset",
      assetId: asset.assetId,
      role: asset.role,
      casSha256: asset.casSha256,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
      dominantColorsHex: [...asset.dominantColorsHex],
      licenseAttestation: asset.licenseAttestation,
      placeholder: asset.placeholder,
      byteLength: asset.byteLength,
      basis: asset.placeholder ? "defaulted" : "observed",
    };
    const contentHash = computeNodeContentHash({
      kind: "asset",
      title,
      text: asset.altText,
      fields,
    });
    const fieldsJson = JSON.stringify(fields);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.revision += 1;
      const rev = this.revision;
      const changeSet = `CS-BA-${rev}`;
      this.db.prepare(
        "INSERT INTO change_sets(id, rev, origin, author, created_at, summary) VALUES (?, ?, 'intake', 'brand-asset-registry', ?, ?)",
      ).run(changeSet, rev, rev, `Register ${asset.role}`);
      const existing = this.readIdentity(asset.assetId);
      if (!existing) {
        this.db.prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, owner_role, change_set, created_rev, updated_rev)
           VALUES (?, 'asset', 1, ?, ?, ?, ?, 'active', 'intake', ?, ?, ?)`,
        ).run(asset.assetId, contentHash, title, asset.altText, fieldsJson, changeSet, rev, rev);
      } else if (existing.contentHash !== contentHash) {
        this.db.prepare(
          `UPDATE nodes
              SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, change_set = ?, updated_rev = ?
            WHERE id = ? AND version = ?`,
        ).run(existing.version + 1, contentHash, title, asset.altText, fieldsJson, changeSet, rev, asset.assetId, existing.version);
      }
      this.upsertArtifact(asset, rev);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list(): readonly StoredBrandAsset[] {
    const rows = this.db.prepare(
      "SELECT fields FROM nodes WHERE kind = 'asset' AND status = 'active' AND fields ->> '$.recordType' = 'brand_asset' ORDER BY id",
    ).all();
    return rows.map((row) => parseStored(row.fields));
  }

  getByRole(role: BrandAssetRole): StoredBrandAsset | null {
    const row = this.db.prepare(
      "SELECT fields FROM nodes WHERE id = ? AND kind = 'asset' AND status = 'active'",
    ).get(assetIdForRole(role));
    if (!row) return null;
    return parseStored(row.fields);
  }

  private readIdentity(id: string): NodeIdentity | null {
    const row = this.db.prepare("SELECT version, content_hash FROM nodes WHERE id = ?").get(id);
    if (!row) return null;
    return { version: Number(row.version), contentHash: String(row.content_hash) };
  }

  private upsertArtifact(asset: StoredBrandAsset, createdAt: number): void {
    const artifactId = `ART-${asset.assetId}`;
    const existing = this.db.prepare("SELECT id FROM artifacts WHERE id = ?").get(artifactId);
    if (!existing) {
      this.db.prepare(
        "INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at) VALUES (?, ?, 'asset', ?, ?, 'asset', ?)",
      ).run(artifactId, asset.casSha256, asset.byteLength, asset.mimeType, createdAt);
      this.db.prepare(
        "INSERT INTO artifact_refs(artifact, owner_kind, owner_id) VALUES (?, 'brand_asset', ?)",
      ).run(artifactId, asset.assetId);
      return;
    }
    this.db.prepare("UPDATE artifacts SET hash = ?, mime = ?, bytes = ? WHERE id = ?").run(
      asset.casSha256,
      asset.mimeType,
      asset.byteLength,
      artifactId,
    );
  }
}

function parseStored(value: unknown): StoredBrandAsset {
  const parsed: unknown = JSON.parse(String(value ?? "{}"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("brand asset node fields are not an object");
  }
  const fields = parsed as Record<string, unknown>;
  const colors = Array.isArray(fields.dominantColorsHex)
    ? fields.dominantColorsHex.filter((color): color is string => typeof color === "string")
    : [];
  return {
    assetId: String(fields.assetId),
    role: fields.role as BrandAssetRole,
    casSha256: String(fields.casSha256),
    mimeType: String(fields.mimeType),
    width: Number(fields.width),
    height: Number(fields.height),
    altText: String(fields.altText),
    dominantColorsHex: colors,
      licenseAttestation: typeof fields.licenseAttestation === "string" ? fields.licenseAttestation : null,
      placeholder: fields.placeholder === true,
      byteLength: Number(fields.byteLength ?? 0),
    };
}

function splitSearchText(value: unknown): string {
  const text = value == null ? "" : String(value);
  const extra = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${text} ${extra}`;
}
