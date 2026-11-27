import type { CasBlobStore } from "../cas/store.js";
import { toArtifactCasPort } from "../cas/ports.js";
import { ArtifactManager, type ArtifactManagerOptions } from "./artifact-manager.js";

/**
 * Bind `ArtifactManager` to the unified `CasBlobStore`.
 * The manager keeps the caller's project and global database handles.
 */
export function bindArtifactManager(
  options: Omit<ArtifactManagerOptions, "cas"> & { readonly casStore: CasBlobStore },
): ArtifactManager {
  const { casStore, ...rest } = options;
  return new ArtifactManager({
    ...rest,
    cas: toArtifactCasPort(casStore),
  });
}
