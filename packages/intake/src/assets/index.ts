export { BrandAssetError, CasBlobMissingError, CasIntegrityMismatchError, FontLicenseError, RasterSafetyError } from "./errors.js";
export { CANONICAL_HASH_SOURCE, computeNodeContentHash, digestSha256, sha256Hex } from "./canonical-hash.js";
export {
  BRAND_ASSET_ROLES,
  DERIVATIVE_SIZES,
  FONT_ATTESTATION_PHRASE,
  MAX_ANIMATION_FRAMES,
  MAX_RASTER_BYTES,
  MAX_RASTER_PIXELS,
  NEUTRAL_BRAND_TOKENS,
  VISUAL_BRAND_ROLES,
  type BrandAssetRole,
  type BrandColorTokens,
  type DerivativeName,
} from "./limits.js";
export {
  CAS_BLOB_STORE_SOURCE,
  DESIGN_SYSTEM_SOURCE,
  type BrandColorSuggestion,
  type CasBlobStorePort,
  type CasPutOptions,
  type CasWriteResult,
  type DesignSystemScaffoldBuilderPort,
} from "./ports.js";
export { MemoryCasBlobStore } from "./memory-cas.js";
export { DOMPURIFY_SVG_PROFILE } from "./svg-profile.js";
export { formatRemovedLog, sanitizeSvgMarkup, type SanitizedSvg } from "./svg-sanitizer.js";
export { invertMonochrome, sanitizeRasterBytes, type RasterDerivative, type SanitizedRaster } from "./raster-sanitizer.js";
export { BrandAssetSanitizer, MISSING_LIGHT_LOGO_ALERT } from "./brand-asset-sanitizer.js";
export {
  FontLicenseInspector,
  type FontContainer,
  type FontLicenseClass,
  type FontLicenseReport,
} from "./font-license-inspector.js";
export { assetIdForRole, type BrandAssetStateStore, type StoredBrandAsset } from "./brand-record.js";
export { SqliteBrandAssetState } from "./sqlite-brand-state.js";
export {
  BrandAssetRegistry,
  type FontRegistration,
  type LogoLightOffer,
  type PreparedAsset,
} from "./brand-asset-registry.js";
export { DeterministicPlaceholderGenerator, projectInitials, type PlaceholderBundle } from "./placeholders.js";
export { Phase0BrandAssetsGenerator, type Phase0EmitResult } from "./phase0-generator.js";
export {
  ExternalHotlinkScanner,
  HOTLINK_RULE_ID,
  STOCK_IMAGE_HOSTS,
  scanUnapprovedHotlinks,
  type HotlinkFinding,
  type HotlinkScanOptions,
} from "./hotlink-scanner.js";
