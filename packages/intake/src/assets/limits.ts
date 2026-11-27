/** sharp({ limitInputPixels }) cap. 64 megapixels. */
export const MAX_RASTER_PIXELS = 64_000_000;

/** Uploaded raster bytes, checked before the decoder allocates. */
export const MAX_RASTER_BYTES = 25 * 1024 * 1024;

/** Animated containers above this frame count are rejected before decode. */
export const MAX_ANIMATION_FRAMES = 256;

export const DERIVATIVE_SIZES = {
  favicon: { width: 32, height: 32 },
  logo1x: { width: 256, height: 256 },
  logo2x: { width: 512, height: 512 },
  ogImage: { width: 1200, height: 630 },
} as const;

export type DerivativeName = keyof typeof DERIVATIVE_SIZES;

export const FONT_ATTESTATION_PHRASE = "I hold a web embedding license for this font";

export const MISSING_LIGHT_LOGO_ALERT =
  "logo_light is missing. A dark logo on a dark surface can disappear. Accept the auto-inverted monochrome variant or the generated placeholder before shipping.";

export const BRAND_ASSET_ROLES = [
  "logo_light",
  "logo_dark",
  "favicon",
  "hero",
  "avatar_fallback",
  "font",
] as const;

export type BrandAssetRole = (typeof BRAND_ASSET_ROLES)[number];

export const VISUAL_BRAND_ROLES = [
  "logo_light",
  "logo_dark",
  "favicon",
  "hero",
  "avatar_fallback",
] as const satisfies readonly BrandAssetRole[];

export const NEUTRAL_BRAND_TOKENS = {
  surface: "#F5F4F1",
  raised: "#E7E5E4",
  muted: "#D6D3D1",
  ink: "#1C1917",
  accent: "#44403C",
} as const;

export interface BrandColorTokens {
  readonly surface: string;
  readonly raised: string;
  readonly muted: string;
  readonly ink: string;
  readonly accent: string;
}
