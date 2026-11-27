import type { BrandAssetRole } from "./limits.js";

export interface StoredBrandAsset {
  readonly assetId: string;
  readonly role: BrandAssetRole;
  readonly casSha256: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string;
  readonly dominantColorsHex: readonly string[];
  readonly licenseAttestation: string | null;
  readonly placeholder: boolean;
  readonly byteLength: number;
}

export interface BrandAssetStateStore {
  upsert(asset: StoredBrandAsset): void;
  list(): readonly StoredBrandAsset[];
  getByRole(role: BrandAssetRole): StoredBrandAsset | null;
}

export function assetIdForRole(role: BrandAssetRole): string {
  return `BA-${role.replaceAll("_", "-")}`;
}
