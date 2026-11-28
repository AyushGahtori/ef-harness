/** Bundled office art, loaded with fetch from the renderer origin. */

export const OFFICE_FLOOR_PLAN_FILE = "floorplan-v1.tmj";
export const OFFICE_ATLAS_JSON_FILE = "cozy-office-atlas.json";
export const OFFICE_ATLAS_IMAGE_FILE = "cozy-office-atlas.png";
export const OFFICE_TILES_IMAGE_FILE = "office-tiles.png";

const RELATIVE_ASSET_DIRS = ["../../assets/office/", "../../../assets/office/"] as const;

/** `dist/office/renderer` uses `../../assets`; `src/office/renderer` uses `../../../assets`. */
export function officeAssetCandidateUrls(fileName: string, moduleUrl: string = import.meta.url): URL[] {
  return RELATIVE_ASSET_DIRS.map((dir) => new URL(`${dir}${fileName}`, moduleUrl));
}

export async function fetchOfficeAsset(fileName: string): Promise<Uint8Array> {
  let lastFailure = "no candidate url";
  for (const url of officeAssetCandidateUrls(fileName)) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastFailure = `status ${response.status}`;
        continue;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "fetch failed";
    }
  }
  throw new Error(`Unable to fetch office asset ${fileName} (${lastFailure})`);
}

export function decodeOfficeAssetText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
