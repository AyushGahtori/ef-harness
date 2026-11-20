import type { BrandAssetRole } from "./limits.js";

/**
 * Task 028 surface this package needs. `MemoryCasBlobStore` is the stand-in.
 * Swap the constructor argument for `CasBlobStore` from `@ef-harness/db` when that barrel exports it.
 */
export const CAS_BLOB_STORE_SOURCE = "local-port:task-028" as const;

export interface CasWriteResult {
  readonly hash: string;
  readonly bytes: number;
  readonly deduplicated: boolean;
}

export type CasHolderKind = "project" | "backup" | "research" | "export" | "pending";

export interface CasPutOptions {
  readonly holderKind: CasHolderKind;
  readonly holderId: string;
  readonly mime?: string;
  readonly retention?: "asset" | "evidence" | "diagnostic" | "ephemeral" | "research";
}

export interface CasBlobStorePort {
  readonly source: typeof CAS_BLOB_STORE_SOURCE;
  putBlob(bytes: Uint8Array, options: CasPutOptions): CasWriteResult;
  getBlob(hash: string): Uint8Array;
  verifyBlobIntegrity(hash: string): void;
  pinBlob(hash: string, holderKind: CasHolderKind, holderId: string): void;
  unpinHolder(hash: string, holderKind: CasHolderKind, holderId: string): void;
}

export interface BrandColorSuggestion {
  readonly assetId: string;
  readonly role: BrandAssetRole;
  readonly dominantColorsHex: readonly string[];
}

/**
 * Task 094 `DesignSystemScaffoldBuilder` / Look-and-Feel interview hook.
 * The real builder is not on this base. Suggestions are recorded here and
 * forwarded when a scaffold builder is injected.
 */
export const DESIGN_SYSTEM_SOURCE = "local-port:task-094" as const;

export interface DesignSystemScaffoldBuilderPort {
  readonly source: typeof DESIGN_SYSTEM_SOURCE;
  suggestBrandColors(suggestion: BrandColorSuggestion): void;
}
