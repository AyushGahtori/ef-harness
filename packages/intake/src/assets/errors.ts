export class BrandAssetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BrandAssetError";
    this.code = code;
  }
}

export class RasterSafetyError extends BrandAssetError {
  constructor(code: "byte-limit" | "pixel-bomb" | "frame-limit" | "decode", message: string) {
    super(code, message);
    this.name = "RasterSafetyError";
  }
}

export class FontLicenseError extends BrandAssetError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "FontLicenseError";
  }
}

export class CasIntegrityMismatchError extends BrandAssetError {
  readonly hash: string;

  constructor(hash: string) {
    super("cas-integrity-mismatch", `CAS blob ${hash} failed SHA-256 verification`);
    this.name = "CasIntegrityMismatchError";
    this.hash = hash;
  }
}

export class CasBlobMissingError extends BrandAssetError {
  readonly hash: string;

  constructor(hash: string) {
    super("cas-blob-missing", `CAS blob ${hash} is not in the store`);
    this.name = "CasBlobMissingError";
    this.hash = hash;
  }
}
