import { sanitizeRasterBytes, type SanitizedRaster } from "./raster-sanitizer.js";
import { sanitizeSvgMarkup, type SanitizedSvg } from "./svg-sanitizer.js";

export class BrandAssetSanitizer {
  sanitizeSvg(input: string | Uint8Array): SanitizedSvg {
    const source = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
    return sanitizeSvgMarkup(source);
  }

  sanitizeRaster(input: Uint8Array, mimeType?: string): Promise<SanitizedRaster> {
    void mimeType;
    return sanitizeRasterBytes(input);
  }
}

export const MISSING_LIGHT_LOGO_ALERT =
  "logo_light is missing. A dark logo on a dark surface can disappear. Accept the auto-inverted monochrome variant or the generated placeholder before shipping.";
