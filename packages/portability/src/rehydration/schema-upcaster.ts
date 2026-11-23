import type { ExportManifest } from "./types.js";
import { CURRENT_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from "./types.js";
import { RehydrationError } from "./errors.js";

export function upcastManifest(manifest: ExportManifest, maxKnownSchema = CURRENT_SCHEMA_VERSION): ExportManifest {
  if (manifest.schemaVersion > maxKnownSchema) {
    throw new RehydrationError(
      "schema_too_new",
      `manifest schemaVersion ${manifest.schemaVersion} is newer than app max ${maxKnownSchema}`,
    );
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
    throw new RehydrationError(
      "schema_unsupported",
      `manifest schemaVersion ${manifest.schemaVersion} is not supported`,
    );
  }
  return manifest;
}