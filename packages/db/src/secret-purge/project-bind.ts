import type { CasBlobStore } from "../cas/store.js";
import { toSecretPurgeCasPort } from "../cas/ports.js";
import { SecretPurgeEngine } from "./engine.js";
import type { SecretPurgeEngineOptions } from "./types.js";

/**
 * Bind `SecretPurgeEngine` to the unified `CasBlobStore`.
 * The engine keeps the caller's project `state.db` handle and does not open another one.
 */
export function bindSecretPurgeEngine(
  options: Omit<SecretPurgeEngineOptions, "cas"> & { readonly casStore: CasBlobStore },
): SecretPurgeEngine {
  const { casStore, ...rest } = options;
  return new SecretPurgeEngine({
    ...rest,
    cas: toSecretPurgeCasPort(casStore),
    casRoot: rest.casRoot ?? casStore.rootDirectory,
  });
}
