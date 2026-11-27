import { BrandAssetError } from "./errors.js";
import { BrandAssetSanitizer, MISSING_LIGHT_LOGO_ALERT } from "./brand-asset-sanitizer.js";
import { assetIdForRole, type BrandAssetStateStore, type StoredBrandAsset } from "./brand-record.js";
import { FontLicenseInspector, type FontLicenseReport } from "./font-license-inspector.js";
import type { BrandAssetRole } from "./limits.js";
import { invertMonochrome } from "./raster-sanitizer.js";
import type { BrandColorSuggestion, CasBlobStorePort, DesignSystemScaffoldBuilderPort } from "./ports.js";

export interface LogoLightOffer {
  readonly role: "logo_light";
  readonly kind: "inverted-monochrome" | "placeholder";
  readonly message: string;
  readonly bytes: Buffer | null;
}

export interface FontRegistration {
  readonly status: "registered" | "needs-attestation";
  readonly report: FontLicenseReport;
  readonly asset: StoredBrandAsset | null;
}

export interface PreparedAsset {
  readonly role: BrandAssetRole;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly altText: string;
  readonly dominantColorsHex: readonly string[];
  readonly placeholder: boolean;
  readonly licenseAttestation?: string | null;
}

export class BrandAssetRegistry {
  private readonly sanitizer: BrandAssetSanitizer;
  private readonly fonts: FontLicenseInspector;
  private readonly projectId: string;
  private readonly designSystem: DesignSystemScaffoldBuilderPort | null;
  private readonly alertsInternal: string[] = [];
  private readonly offersInternal: LogoLightOffer[] = [];
  private readonly suggestionsInternal: BrandColorSuggestion[] = [];

  constructor(private readonly options: {
    readonly cas: CasBlobStorePort;
    readonly state: BrandAssetStateStore;
    readonly designSystem?: DesignSystemScaffoldBuilderPort;
    readonly sanitizer?: BrandAssetSanitizer;
    readonly fonts?: FontLicenseInspector;
    readonly projectId?: string;
  }) {
    this.sanitizer = options.sanitizer ?? new BrandAssetSanitizer();
    this.fonts = options.fonts ?? new FontLicenseInspector();
    this.projectId = options.projectId ?? "brand-assets";
    this.designSystem = options.designSystem ?? null;
  }

  get alerts(): readonly string[] {
    return this.alertsInternal;
  }

  get offers(): readonly LogoLightOffer[] {
    return this.offersInternal;
  }

  get colorSuggestions(): readonly BrandColorSuggestion[] {
    return this.suggestionsInternal;
  }

  async registerSvg(input: string | Uint8Array, options: {
    readonly role: BrandAssetRole;
    readonly altText: string;
  }): Promise<StoredBrandAsset> {
    const sanitized = this.sanitizer.sanitizeSvg(input);
    return this.persist({
      role: options.role,
      mimeType: "image/svg+xml",
      bytes: Buffer.from(sanitized.svg, "utf8"),
      width: sanitized.width,
      height: sanitized.height,
      altText: options.altText,
      dominantColorsHex: sanitized.dominantColorsHex,
      placeholder: false,
      licenseAttestation: null,
    });
  }

  async registerRaster(input: Uint8Array, options: {
    readonly role: BrandAssetRole;
    readonly altText: string;
    readonly mimeType?: string;
  }): Promise<StoredBrandAsset> {
    const sanitized = await this.sanitizer.sanitizeRaster(input, options.mimeType);
    const colors = sanitized.dominantColorsHex;
    return this.persist({
      role: options.role,
      mimeType: sanitized.mimeType,
      bytes: sanitized.bytes,
      width: sanitized.width,
      height: sanitized.height,
      altText: options.altText,
      dominantColorsHex: colors,
      placeholder: false,
      licenseAttestation: null,
    });
  }

  async registerFont(input: Uint8Array, filename: string, attestation?: string): Promise<FontRegistration> {
    const inspected = this.fonts.inspect(input, filename);
    const report = attestation === undefined ? inspected : this.fonts.withAttestation(inspected, attestation);
    if (!report.bundleAllowed) {
      return { status: "needs-attestation", report, asset: null };
    }
    const asset = this.persist({
      role: "font",
      mimeType: fontMime(report.container),
      bytes: Buffer.from(input),
      width: 0,
      height: 0,
      altText: report.familyName,
      dominantColorsHex: [],
      placeholder: false,
      licenseAttestation: report.attestationAccepted ? report.attestationPhrase : null,
    });
    return { status: "registered", report, asset: await asset };
  }

  async registerPrepared(asset: PreparedAsset): Promise<StoredBrandAsset> {
    if (asset.mimeType === "image/svg+xml") {
      const sanitized = this.sanitizer.sanitizeSvg(asset.bytes);
      return this.persist({
        ...asset,
        bytes: Buffer.from(sanitized.svg, "utf8"),
        width: sanitized.width,
        height: sanitized.height,
        dominantColorsHex: sanitized.dominantColorsHex.length > 0 ? sanitized.dominantColorsHex : asset.dominantColorsHex,
        licenseAttestation: asset.licenseAttestation ?? null,
      });
    }
    if (asset.mimeType.startsWith("image/")) {
      const sanitized = await this.sanitizer.sanitizeRaster(asset.bytes, asset.mimeType);
      return this.persist({
        ...asset,
        bytes: sanitized.bytes,
        mimeType: sanitized.mimeType,
        width: sanitized.width,
        height: sanitized.height,
        dominantColorsHex: sanitized.dominantColorsHex,
        licenseAttestation: asset.licenseAttestation ?? null,
      });
    }
    return this.persist({
      ...asset,
      licenseAttestation: asset.licenseAttestation ?? null,
    });
  }

  async acceptInvertedLogoLight(altText = "Light logo, auto-inverted from the dark logo"): Promise<StoredBrandAsset> {
    const offer = this.offersInternal.find((item) => item.kind === "inverted-monochrome");
    if (!offer?.bytes) {
      throw new BrandAssetError("missing-offer", "No inverted monochrome logo_light offer is waiting");
    }
    return this.registerRaster(offer.bytes, { role: "logo_light", altText, mimeType: "image/png" });
  }

  list(): readonly StoredBrandAsset[] {
    return this.options.state.list();
  }

  get(role: BrandAssetRole): StoredBrandAsset | null {
    return this.options.state.getByRole(role);
  }

  readBytes(role: BrandAssetRole): Uint8Array {
    const stored = this.options.state.getByRole(role);
    if (!stored) throw new BrandAssetError("missing-asset", `No brand asset is registered for ${role}`);
    return this.options.cas.getBlob(stored.casSha256);
  }

  private async persist(asset: PreparedAsset & { licenseAttestation: string | null }): Promise<StoredBrandAsset> {
    const written = this.options.cas.putBlob(asset.bytes, {
      holderKind: "project",
      holderId: this.projectId,
      mime: asset.mimeType,
      retention: "asset",
    });
    this.options.cas.verifyBlobIntegrity(written.hash);
    const stored: StoredBrandAsset = {
      assetId: assetIdForRole(asset.role),
      role: asset.role,
      casSha256: written.hash,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
      dominantColorsHex: asset.dominantColorsHex,
      licenseAttestation: asset.licenseAttestation,
      placeholder: asset.placeholder,
      byteLength: asset.bytes.byteLength,
    };
    this.options.state.upsert(stored);
    this.suggest(stored);
    await this.noteLogoPair(stored, asset.bytes);
    return stored;
  }

  private suggest(asset: StoredBrandAsset): void {
    if (asset.role === "font" || asset.dominantColorsHex.length === 0) return;
    const suggestion: BrandColorSuggestion = {
      assetId: asset.assetId,
      role: asset.role,
      dominantColorsHex: asset.dominantColorsHex,
    };
    this.suggestionsInternal.push(suggestion);
    this.designSystem?.suggestBrandColors(suggestion);
  }

  private async noteLogoPair(asset: StoredBrandAsset, bytes: Uint8Array): Promise<void> {
    if (asset.placeholder) return;
    if (asset.role === "logo_light") {
      this.alertsInternal.splice(0, this.alertsInternal.length, ...this.alertsInternal.filter((alert) => alert !== MISSING_LIGHT_LOGO_ALERT));
      this.offersInternal.splice(0, this.offersInternal.length);
      return;
    }
    if (asset.role !== "logo_dark" || this.options.state.getByRole("logo_light")) return;
    if (!this.alertsInternal.includes(MISSING_LIGHT_LOGO_ALERT)) this.alertsInternal.push(MISSING_LIGHT_LOGO_ALERT);
    const inverted = await invertMonochrome(bytes);
    this.offersInternal.splice(0, this.offersInternal.length, {
      role: "logo_light",
      kind: "inverted-monochrome",
      message: "Auto-inverted monochrome of logo_dark, so a light theme does not ship an invisible mark.",
      bytes: inverted,
    }, {
      role: "logo_light",
      kind: "placeholder",
      message: "Deterministic monogram placeholder for logo_light.",
      bytes: null,
    });
  }
}

function fontMime(container: "woff2" | "woff" | "ttf" | "otf"): string {
  if (container === "woff2") return "font/woff2";
  if (container === "woff") return "font/woff";
  if (container === "otf") return "font/otf";
  return "font/ttf";
}
