import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrandAssetError } from "./errors.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Repository root that already declares sharp, fontkit, and dompurify. */
export function repositoryRoot(): string {
  return path.resolve(moduleDir, "..", "..", "..", "..");
}

function requireFromRepository(specifier: string): unknown {
  const require = createRequire(path.join(repositoryRoot(), "package.json"));
  try {
    return require(specifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrandAssetError(
      "engine-missing",
      `Cannot load ${specifier} from the repository root. ${message}`,
    );
  }
}

export interface SharpMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly format?: string;
  readonly pages?: number;
  readonly pageHeight?: number;
  readonly exif?: Buffer;
  readonly xmp?: Buffer;
  readonly iptc?: Buffer;
  readonly icc?: Buffer;
  readonly orientation?: number;
}

export interface SharpStats {
  readonly dominant: { readonly r: number; readonly g: number; readonly b: number };
}

export interface SharpRawResult {
  readonly data: Buffer;
  readonly info: { readonly width: number; readonly height: number; readonly channels: number };
}

export interface SharpInstance {
  metadata(): Promise<SharpMetadata>;
  stats(): Promise<SharpStats>;
  rotate(): SharpInstance;
  resize(
    width: number,
    height: number,
    options: {
      readonly fit: "contain" | "fill";
      readonly background: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };
    },
  ): SharpInstance;
  removeAlpha(): SharpInstance;
  greyscale(): SharpInstance;
  negate(options?: { readonly alpha: boolean }): SharpInstance;
  png(options?: { readonly compressionLevel?: number }): SharpInstance;
  raw(): SharpInstance;
  toBuffer(): Promise<Buffer>;
  toBuffer(options: { readonly resolveWithObject: true }): Promise<SharpRawResult>;
}

export interface SharpFactory {
  (
    input: Buffer | Uint8Array,
    options?: {
      readonly limitInputPixels?: number;
      readonly animated?: boolean;
      readonly failOn?: "none" | "truncated" | "error" | "warning";
    },
  ): SharpInstance;
}

export function loadSharp(): SharpFactory {
  const loaded = requireFromRepository("sharp");
  if (typeof loaded !== "function") {
    throw new BrandAssetError("engine-missing", "The sharp export is not a function");
  }
  return loaded as SharpFactory;
}

export interface FontkitFsType {
  readonly noEmbedding?: boolean;
  readonly viewOnly?: boolean;
  readonly editable?: boolean;
  readonly noSubsetting?: boolean;
  readonly bitmapOnly?: boolean;
}

export interface FontkitFont {
  readonly familyName?: string;
  readonly subfamilyName?: string;
  readonly fullName?: string;
  readonly postscriptName?: string;
  readonly numGlyphs?: number;
  readonly characterSet?: readonly number[];
  readonly "OS/2"?: {
    readonly usWeightClass?: number;
    readonly fsType?: FontkitFsType;
    readonly fsSelection?: { readonly italic?: boolean; readonly bold?: boolean };
  };
  readonly name?: { readonly records?: Readonly<Record<string, unknown>> };
}

export interface FontkitModule {
  create(buffer: Buffer | Uint8Array, postscriptName?: string): FontkitFont;
}

export function loadFontkit(): FontkitModule {
  const loaded = requireFromRepository("fontkit");
  if (typeof loaded !== "object" || loaded === null || !("create" in loaded)) {
    throw new BrandAssetError("engine-missing", "fontkit did not export create");
  }
  const create = loaded.create;
  if (typeof create !== "function") {
    throw new BrandAssetError("engine-missing", "fontkit.create is not a function");
  }
  return loaded as FontkitModule;
}

/**
 * DOMPurify is installed at the repository root. Its SVG profile is applied by
 * `svg-profile.ts` because `dompurify` sanitizes through a DOM window and `jsdom`
 * is not installed. When a caller supplies a DOM window, this loader returns the
 * factory so the same bytes can be passed through DOMPurify as well.
 */
export interface DomPurifyInstance {
  sanitize(source: string, config: { readonly USE_PROFILES: { readonly svg: true; readonly svgFilters: true } }): string;
}

export interface DomPurifyFactory {
  (window: object): DomPurifyInstance;
}

export function loadDomPurifyFactory(): DomPurifyFactory | null {
  try {
    const loaded = requireFromRepository("dompurify");
    const factory = typeof loaded === "function"
      ? loaded
      : typeof loaded === "object" && loaded !== null && "default" in loaded
        ? loaded.default
        : null;
    return typeof factory === "function" ? (factory as DomPurifyFactory) : null;
  } catch {
    return null;
  }
}
