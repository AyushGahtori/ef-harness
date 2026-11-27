import {
  CasBlobMissingError as DbCasBlobMissingError,
  bindKnowledgeGraph,
  type CasBlobStore as DbCasBlobStore,
  type KnowledgeGraphRepo,
  type ProjectStateDb,
} from "@ef-harness/db";
import type { AssetSanitizer } from "./brand-asset-registry.js";
import { BrandAssetRegistry } from "./brand-asset-registry.js";
import { assetIdForRole, type BrandAssetStateStore, type StoredBrandAsset } from "./brand-record.js";
import { sha256Hex } from "./canonical-hash.js";
import { CasBlobMissingError, CasIntegrityMismatchError } from "./errors.js";
import { BRAND_ASSET_ROLES, type BrandAssetRole } from "./limits.js";
import {
  CAS_BLOB_STORE_SOURCE,
  type CasBlobStorePort,
  type CasPutOptions,
  type CasWriteResult,
  type DesignSystemScaffoldBuilderPort,
} from "./ports.js";

export interface SanitizeAndRegisterInput {
  readonly bytes: Uint8Array;
  readonly role: BrandAssetRole;
  readonly altText: string;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly state: ProjectStateDb;
  readonly cas: DbCasBlobStore;
  readonly holderId: string;
  readonly designSystem?: DesignSystemScaffoldBuilderPort;
}

/**
 * Sync view of `@ef-harness/db` `CasBlobStore` for the brand registry.
 * Bytes are stored raw so an already-compressed image is not wrapped again.
 * The digest returned here is bare hex, matching the registry contract.
 */
export class ProjectCasBlobStore implements CasBlobStorePort {
  readonly source = CAS_BLOB_STORE_SOURCE;

  constructor(
    private readonly store: DbCasBlobStore,
    private readonly holderId: string,
  ) {}

  putBlob(bytes: Uint8Array, options: CasPutOptions): CasWriteResult {
    const holderId = options.holderId.length > 0 ? options.holderId : this.holderId;
    const written = this.store.putPreframedSync({
      uncompressed: bytes,
      storedPayload: bytes,
      format: "raw",
      holderKind: options.holderKind,
      holderId,
    });
    return { hash: written.hash, bytes: written.bytes, deduplicated: written.deduplicated };
  }

  getBlob(hash: string): Uint8Array {
    try {
      return this.store.readPlainSync(hash);
    } catch (error) {
      if (error instanceof DbCasBlobMissingError) throw new CasBlobMissingError(hash);
      throw error;
    }
  }

  verifyBlobIntegrity(hash: string): void {
    const plain = this.getBlob(hash);
    if (sha256Hex(plain) !== hash) throw new CasIntegrityMismatchError(hash);
  }

  pinBlob(hash: string, holderKind: CasPutOptions["holderKind"], holderId: string): void {
    this.store.pinBlob(hash, holderKind, holderId);
  }

  unpinHolder(hash: string, holderKind: CasPutOptions["holderKind"], holderId: string): void {
    this.store.unpinHolder(hash, holderKind, holderId);
  }
}

/**
 * Brand metadata in the open `ProjectStateDb`: an `asset` node plus an `artifacts` row.
 * This store does not open its own SQLite file.
 */
export class ProjectBrandAssetState implements BrandAssetStateStore {
  private readonly graph: KnowledgeGraphRepo;

  constructor(private readonly state: ProjectStateDb) {
    this.graph = bindKnowledgeGraph(state);
  }

  upsert(asset: StoredBrandAsset): void {
    const title = `Brand asset ${asset.role}`;
    const fields = brandFields(asset);
    const existing = this.graph.getNode(asset.assetId);
    if (!existing) {
      this.graph.commitChangeSet({
        origin: "intake",
        author: "brand-asset-registry",
        summary: `Register ${asset.role}`,
        nodes: [
          {
            op: "create",
            id: asset.assetId,
            kind: "asset",
            title,
            text: asset.altText,
            fields,
            status: "active",
            ownerRole: "intake",
          },
        ],
      });
    } else {
      this.graph.commitChangeSet({
        origin: "intake",
        author: "brand-asset-registry",
        summary: `Register ${asset.role}`,
        nodes: [
          {
            op: "update",
            id: asset.assetId,
            class: "compatible",
            title,
            text: asset.altText,
            fields,
            status: "active",
            ownerRole: "intake",
          },
        ],
      });
    }
    this.writeArtifact(asset);
  }

  list(): readonly StoredBrandAsset[] {
    const rows = this.state.writer.all(
      "SELECT id FROM nodes WHERE kind = 'asset' AND status = 'active' AND fields ->> '$.recordType' = 'brand_asset' ORDER BY id",
    );
    const assets: StoredBrandAsset[] = [];
    for (const row of rows) {
      const id = textColumn(row, "id");
      if (!id) continue;
      const stored = this.read(id);
      if (stored) assets.push(stored);
    }
    return assets;
  }

  getByRole(role: BrandAssetRole): StoredBrandAsset | null {
    return this.read(assetIdForRole(role));
  }

  private read(id: string): StoredBrandAsset | null {
    const node = this.graph.getNode(id);
    if (!node || node.kind !== "asset" || node.status !== "active") return null;
    return parseStored(node.fields);
  }

  private writeArtifact(asset: StoredBrandAsset): void {
    const artifactId = `ART-${asset.assetId}`;
    const createdAt = Date.now();
    this.state.writer.transaction(() => {
      const existing = this.state.writer.get("SELECT id FROM artifacts WHERE id = ?", [artifactId]);
      if (!existing) {
        this.state.writer.run(
          "INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at) VALUES (?, ?, 'asset', ?, ?, 'asset', ?)",
          [artifactId, asset.casSha256, asset.byteLength, asset.mimeType, createdAt],
        );
        this.state.writer.run(
          "INSERT INTO artifact_refs(artifact, owner_kind, owner_id) VALUES (?, 'brand_asset', ?)",
          [artifactId, asset.assetId],
        );
        return;
      }
      this.state.writer.run("UPDATE artifacts SET hash = ?, mime = ?, bytes = ? WHERE id = ?", [
        asset.casSha256,
        asset.mimeType,
        asset.byteLength,
        artifactId,
      ]);
    });
  }
}

export async function registerWithProjectStores(
  sanitizer: AssetSanitizer,
  input: SanitizeAndRegisterInput,
): Promise<StoredBrandAsset> {
  const registry = new BrandAssetRegistry({
    cas: new ProjectCasBlobStore(input.cas, input.holderId),
    state: new ProjectBrandAssetState(input.state),
    projectId: input.holderId,
    sanitizer,
    ...(input.designSystem ? { designSystem: input.designSystem } : {}),
  });
  if (isSvg(input)) {
    return registry.registerSvg(input.bytes, { role: input.role, altText: input.altText });
  }
  return registry.registerRaster(input.bytes, {
    role: input.role,
    altText: input.altText,
    ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
  });
}

function isSvg(input: SanitizeAndRegisterInput): boolean {
  if (input.mimeType === "image/svg+xml") return true;
  if (input.fileName?.toLowerCase().endsWith(".svg")) return true;
  const head = Buffer.from(input.bytes.subarray(0, 256)).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg");
}

function brandFields(asset: StoredBrandAsset): Record<string, unknown> {
  return {
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
}

function parseStored(value: unknown): StoredBrandAsset | null {
  if (!isRecord(value) || value.recordType !== "brand_asset") return null;
  if (!isRole(value.role) || typeof value.assetId !== "string" || typeof value.casSha256 !== "string") return null;
  if (typeof value.mimeType !== "string" || typeof value.altText !== "string") return null;
  const colors = Array.isArray(value.dominantColorsHex)
    ? value.dominantColorsHex.filter((color): color is string => typeof color === "string")
    : [];
  return {
    assetId: value.assetId,
    role: value.role,
    casSha256: value.casSha256,
    mimeType: value.mimeType,
    width: numberValue(value.width),
    height: numberValue(value.height),
    altText: value.altText,
    dominantColorsHex: colors,
    licenseAttestation: typeof value.licenseAttestation === "string" ? value.licenseAttestation : null,
    placeholder: value.placeholder === true,
    byteLength: numberValue(value.byteLength),
  };
}

function isRole(value: unknown): value is BrandAssetRole {
  return typeof value === "string" && (BRAND_ASSET_ROLES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textColumn(row: unknown, key: string): string | null {
  if (!isRecord(row)) return null;
  const value = row[key];
  return typeof value === "string" ? value : null;
}
