/**
 * Release-pipeline pin. The matching private key is not stored in this repository.
 * Task 196 signs component manifests with the offline key and this build only verifies.
 */
export const BUNDLED_COMPONENT_MANIFEST_KEY_ID = "ef-harness-components-2026";

export const BUNDLED_COMPONENT_MANIFEST_PUBLIC_KEY_BASE64 =
  "gwa82Oeg7smBGTdoYQXyTEc0PKl2kyyFOEUO/1HerQw=";

export function bundledComponentManifestPublicKey(): Uint8Array {
  const raw = Buffer.from(BUNDLED_COMPONENT_MANIFEST_PUBLIC_KEY_BASE64, "base64");
  if (raw.length !== 32) {
    throw new Error("Bundled component manifest public key is not 32 bytes");
  }
  return raw;
}
