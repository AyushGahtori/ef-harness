import {
  decodeOfficeAssetText,
  fetchOfficeAsset,
  OFFICE_ATLAS_IMAGE_FILE,
  OFFICE_ATLAS_JSON_FILE,
} from "./asset-paths.js";
import { sortByDepthAndY } from "./sprite-depth-order.js";
import type { AsepriteFrame, SpriteDepthLayer } from "./types.js";

export const COZY_ATLAS_MAX_BYTES = 24 * 1024 * 1024;
export const PIXEL_ART_TILE_SIZE = 16;

type AsepriteJson = {
  readonly frames: Record<string, AsepriteFrame & { readonly rotated?: boolean; readonly trimmed?: boolean }>;
  readonly meta: {
    readonly image: string;
    readonly size: { readonly w: number; readonly h: number };
    readonly layers?: ReadonlyArray<{ readonly name: string }>;
  };
};

const FRAME_LAYER_HINT: Record<string, SpriteDepthLayer> = {
  "floor/": "floor",
  "prop/plant": "furniture",
  "prop/lamp": "furniture",
  "prop/bookshelf": "furniture",
  "prop/coffee-bar": "furniture",
  "char/": "characters",
  "outfit/": "characters",
  "prop/clipboard": "desk-props",
  "prop/magnifier": "desk-props",
  "prop/hard-hat": "desk-props",
  "icon/": "status-icons",
  "label/": "labels",
};

function layerForFrameName(name: string): SpriteDepthLayer {
  for (const prefix of Object.keys(FRAME_LAYER_HINT)) {
    if (name.startsWith(prefix)) {
      return FRAME_LAYER_HINT[prefix]!;
    }
  }
  if (name.includes("rug")) {
    return "rugs";
  }
  return "furniture";
}

export type AtlasFrameRecord = {
  readonly name: string;
  readonly frame: AsepriteFrame["frame"];
  readonly depth: SpriteDepthLayer;
};

export class CozyPixelSpriteAtlasEngine {
  static readonly scaleMode = "nearest" as const;

  private readonly frames: Map<string, AtlasFrameRecord> = new Map();
  private imageBytes = 0;
  private metaWidth = 0;
  private metaHeight = 0;

  loadFromParts(jsonText: string, imageByteLength: number): void {
    const parsed = JSON.parse(jsonText) as AsepriteJson;
    this.frames.clear();
    this.metaWidth = parsed.meta.size.w;
    this.metaHeight = parsed.meta.size.h;
    this.imageBytes = imageByteLength;
    for (const [name, frame] of Object.entries(parsed.frames)) {
      this.frames.set(name, {
        name,
        frame: frame.frame,
        depth: layerForFrameName(name),
      });
    }
    this.assertIntegrity(parsed);
  }

  /** Load the cozy atlas JSON and PNG sheet by fetch, or from injected parts. */
  async loadFromDisk(injected?: { readonly jsonText: string; readonly imageByteLength: number }): Promise<void> {
    if (injected) {
      this.loadFromParts(injected.jsonText, injected.imageByteLength);
      return;
    }
    const jsonBytes = await fetchOfficeAsset(OFFICE_ATLAS_JSON_FILE);
    const imageBytes = await fetchOfficeAsset(OFFICE_ATLAS_IMAGE_FILE);
    this.loadFromParts(decodeOfficeAssetText(jsonBytes), imageBytes.byteLength);
  }

  listFrames(): ReadonlyArray<AtlasFrameRecord> {
    return sortByDepthAndY(
      [...this.frames.values()].map((f) => ({
        ...f,
        y: f.frame.y,
        depth: f.depth,
      })),
    );
  }

  getFrame(name: string): AtlasFrameRecord | undefined {
    return this.frames.get(name);
  }

  estimateGpuBytes(): number {
    return this.metaWidth * this.metaHeight * 4;
  }

  totalImageBytes(): number {
    return this.imageBytes;
  }

  withinBudget(): boolean {
    return this.estimateGpuBytes() < COZY_ATLAS_MAX_BYTES && this.imageBytes < COZY_ATLAS_MAX_BYTES;
  }

  private assertIntegrity(parsed: AsepriteJson): void {
    if (this.frames.size < 1) {
      throw new Error("atlas has zero frames");
    }
    for (const record of this.frames.values()) {
      const { w, h } = record.frame;
      if (w !== PIXEL_ART_TILE_SIZE || h !== PIXEL_ART_TILE_SIZE) {
        throw new Error(`frame ${record.name} must be 16×16 px`);
      }
    }
    const names = new Set(this.frames.keys());
    const requiredPrefixes = ["floor/", "char/", "outfit/", "icon/", "label/"];
    for (const prefix of requiredPrefixes) {
      if (![...names].some((n) => n.startsWith(prefix))) {
        throw new Error(`atlas missing frames for prefix ${prefix}`);
      }
    }
    if (!parsed.meta.image.endsWith(".png")) {
      throw new Error("atlas meta.image must reference a PNG sheet");
    }
  }
}