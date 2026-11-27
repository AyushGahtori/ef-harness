import { MISSING_LIGHT_LOGO_ALERT } from "./limits.js";
import { registerWithProjectStores, type SanitizeAndRegisterInput } from "./project-brand.js";
import { sanitizeRasterBytes, type SanitizedRaster } from "./raster-sanitizer.js";
import type { StoredBrandAsset } from "./brand-record.js";
import { sanitizeSvgMarkup, type SanitizedSvg } from "./svg-sanitizer.js";

export type RegisteredBrandAsset = StoredBrandAsset;
export type { SanitizeAndRegisterInput };

export class BrandAssetSanitizer {
  sanitizeSvg(input: string | Uint8Array): SanitizedSvg {
    const source = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
    return sanitizeSvgMarkup(source);
  }

  sanitizeRaster(input: Uint8Array, mimeType?: string): Promise<SanitizedRaster> {
    void mimeType;
    return sanitizeRasterBytes(input);
  }

  sanitizeAndRegisterAsset(input: SanitizeAndRegisterInput): Promise<RegisteredBrandAsset> {
    return registerWithProjectStores(this, input);
  }
}

export { MISSING_LIGHT_LOGO_ALERT };
