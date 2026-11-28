import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { blobFilePath } from "@ef-harness/db";
import { toBareSha256Hex, toPrefixedSha256 } from "@ef-harness/shared-contracts";
import { COMMIT_SHA, NUMERIC_PID, SHA256_HEX } from "./constants.js";
import { CasBlobMissingError, CasIntegrityError, InvalidPinError, RoleAddressError, SchemaValidationError } from "./errors.js";
import { sha256Hex } from "./json.js";

export interface CasPutPin {
  readonly holderKind: "project";
  readonly holderId: string;
  readonly retention: "evidence";
}

export interface CasWriteResult {
  readonly hash: string;
  readonly bytes: number;
}

export interface CasBlobStorePort {
  putBlob(content: Uint8Array, pin: CasPutPin): CasWriteResult;
  getBlob(hash: string, retention: "evidence"): Uint8Array;
}

export function assertCasPin(pin: CasPutPin): void {
  if (pin.holderKind !== "project" || pin.retention !== "evidence" || pin.holderId.trim().length === 0) {
    throw new SchemaValidationError("CAS pin must be a project evidence holder.");
  }
}

/** Filesystem CAS using the shared `CasBlobStore` layout. SQLite never holds the bytes. */
export class SqliteCasBlobStore implements CasBlobStorePort {
  constructor(private readonly rootDir: string) {
    mkdirSync(this.rootDir, { recursive: true });
  }

  putBlob(content: Uint8Array, pin: CasPutPin): CasWriteResult {
    assertCasPin(pin);
    const bare = sha256Hex(content);
    const hash = toPrefixedSha256(bare);
    const file = blobFilePath(this.rootDir, hash, "raw");
    mkdirSync(path.dirname(file), { recursive: true });
    if (!existsSync(file)) writeFileSync(file, content);
    const stored = new Uint8Array(readFileSync(file));
    if (sha256Hex(stored) !== bare) throw new CasIntegrityError(hash);
    return { hash, bytes: content.byteLength };
  }

  getBlob(hash: string, retention: "evidence"): Uint8Array {
    if (retention !== "evidence") throw new SchemaValidationError("CAS reads are evidence-class only.");
    const bare = toBareSha256Hex(hash);
    const file = blobFilePath(this.rootDir, bare, "raw");
    if (!existsSync(file)) throw new CasBlobMissingError(hash);
    const stored = new Uint8Array(readFileSync(file));
    if (sha256Hex(stored) !== bare) throw new CasIntegrityError(hash);
    return stored;
  }
}

export class MemoryCasBlobStore implements CasBlobStorePort {
  readonly puts: { hash: string; bytes: number; holderId: string }[] = [];
  private readonly blobs = new Map<string, Uint8Array>();

  putBlob(content: Uint8Array, pin: CasPutPin): CasWriteResult {
    assertCasPin(pin);
    const hash = sha256Hex(content);
    const existing = this.blobs.get(hash);
    if (!existing) this.blobs.set(hash, new Uint8Array(content));
    this.puts.push({ hash, bytes: content.byteLength, holderId: pin.holderId });
    return { hash, bytes: content.byteLength };
  }

  getBlob(hash: string, retention: "evidence"): Uint8Array {
    if (retention !== "evidence") throw new SchemaValidationError("CAS reads are evidence-class only.");
    const found = this.blobs.get(hash);
    if (!found) throw new CasBlobMissingError(hash);
    return new Uint8Array(found);
  }
}

export interface SlicePinPort {
  verify(sliceSha256: string): boolean;
}

export class FormatSlicePinPort implements SlicePinPort {
  verify(sliceSha256: string): boolean {
    return SHA256_HEX.test(sliceSha256);
  }
}

export class CatalogSlicePinPort implements SlicePinPort {
  constructor(private readonly known: ReadonlySet<string>) {}

  verify(sliceSha256: string): boolean {
    return SHA256_HEX.test(sliceSha256) && this.known.has(sliceSha256);
  }
}

export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
}

export interface KnowledgeGraphPort {
  dependsOnEdges(): readonly DependencyEdge[];
  owners(): readonly { contractId: string; ownerRole: string; ownerTaskId: string }[];
}

export class LocalKnowledgeGraphPort implements KnowledgeGraphPort {
  private readonly edges: DependencyEdge[] = [];
  private readonly ownerRows: { contractId: string; ownerRole: string; ownerTaskId: string }[] = [];

  addDependsOn(from: string, to: string): void {
    this.edges.push({ from, to });
  }

  setOwner(contractId: string, ownerRole: string, ownerTaskId: string): void {
    this.ownerRows.push({ contractId, ownerRole, ownerTaskId });
  }

  dependsOnEdges(): readonly DependencyEdge[] {
    return this.edges;
  }

  owners(): readonly { contractId: string; ownerRole: string; ownerTaskId: string }[] {
    return this.ownerRows;
  }
}

export interface TaskHoldsPort {
  isHeld(taskId: string): boolean;
}

export class LocalTaskHoldsPort implements TaskHoldsPort {
  private readonly held = new Set<string>();

  hold(taskId: string): void {
    this.held.add(taskId);
  }

  release(taskId: string): void {
    this.held.delete(taskId);
  }

  isHeld(taskId: string): boolean {
    return this.held.has(taskId);
  }
}

export function assertCanonicalRole(role: string): void {
  if (role.trim().length === 0) throw new RoleAddressError(role, "empty");
  if (NUMERIC_PID.test(role)) throw new RoleAddressError(role, "pid");
}

export function assertCommitSha(value: string): void {
  if (!COMMIT_SHA.test(value)) throw new InvalidPinError("pinnedBaseCommitSha");
}

export function assertSliceSha(value: string): void {
  if (!SHA256_HEX.test(value)) throw new InvalidPinError("pinnedSliceSha256");
}
