import type { KeyObject } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { signEd25519, verifyEd25519 } from "./ed25519.js";
import {
  InvalidManifestSignatureError,
  ManifestParseError,
  MissingComponentDigestError,
  UnpinnedLatestUrlError,
} from "./errors.js";
import { assertSafeComponentId, assertSafeRelativePath } from "./paths.js";

export interface ComponentFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ComponentManifestEntry {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly primaryUrl: string;
  readonly mirrorUrls: readonly string[];
  readonly packaging: "file" | "zip";
  readonly files: readonly ComponentFileEntry[];
}

export interface ComponentManifest {
  readonly keyId: string;
  readonly components: readonly ComponentManifestEntry[];
}

export interface SignedComponentManifest {
  readonly manifest: ComponentManifest;
  readonly signature: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMutableLatestUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const segments = url.pathname.split("/").filter((part) => part.length > 0);
  if (segments.some((part) => part.toLowerCase() === "latest")) return true;
  for (const key of ["version", "tag", "channel"]) {
    const query = url.searchParams.get(key);
    if (query !== null && query.toLowerCase() === "latest") return true;
  }
  return false;
}

export function signComponentManifest(manifest: ComponentManifest, privateKey: KeyObject): string {
  return signEd25519(privateKey, Buffer.from(canonicalJson(manifest), "utf8")).toString("base64");
}

export function verifyManifestSignature(
  manifest: unknown,
  signature: string,
  publicKeyRaw: Uint8Array,
  expectedKeyId: string,
): void {
  if (!isRecord(manifest)) {
    throw new InvalidManifestSignatureError("manifest payload is not an object");
  }
  const signatureBytes = Buffer.from(signature, "base64");
  const ok = verifyEd25519(publicKeyRaw, Buffer.from(canonicalJson(manifest), "utf8"), signatureBytes);
  if (!ok) {
    throw new InvalidManifestSignatureError("Ed25519 manifest signature is invalid");
  }
  if (manifest.keyId !== expectedKeyId) {
    throw new InvalidManifestSignatureError("manifest key id does not match the bundled pin");
  }
}

function readFileEntry(value: unknown): ComponentFileEntry {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.sha256 !== "string") {
    throw new ManifestParseError("component file entry is invalid");
  }
  if (!Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes as number) < 0) {
    throw new ManifestParseError(`component file ${value.path} has an invalid size`);
  }
  return {
    path: assertSafeRelativePath(value.path),
    sha256: value.sha256,
    sizeBytes: value.sizeBytes as number,
  };
}

function readComponent(value: unknown): ComponentManifestEntry {
  if (!isRecord(value)) throw new ManifestParseError("component entry is invalid");
  if (typeof value.id !== "string" || typeof value.label !== "string" || typeof value.version !== "string") {
    throw new ManifestParseError("component identity fields are invalid");
  }
  if (typeof value.sha256 !== "string" || typeof value.primaryUrl !== "string") {
    throw new ManifestParseError(`component ${value.id} is missing a url or digest`);
  }
  if (value.packaging !== "file" && value.packaging !== "zip") {
    throw new ManifestParseError(`component ${value.id} has an unknown packaging`);
  }
  if (!Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes as number) < 0) {
    throw new ManifestParseError(`component ${value.id} has an invalid size`);
  }
  assertSafeComponentId(value.id);
  const mirrorUrls = value.mirrorUrls ?? [];
  if (!Array.isArray(mirrorUrls) || mirrorUrls.some((url) => typeof url !== "string")) {
    throw new ManifestParseError(`component ${value.id} mirrors are invalid`);
  }
  if (mirrorUrls.length > 8) {
    throw new ManifestParseError(`component ${value.id} has too many mirrors`);
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new ManifestParseError(`component ${value.id} lists no files`);
  }
  const files = value.files.map((file) => readFileEntry(file));
  const entry: ComponentManifestEntry = {
    id: value.id,
    label: value.label,
    version: value.version,
    sizeBytes: value.sizeBytes as number,
    sha256: value.sha256,
    primaryUrl: value.primaryUrl,
    mirrorUrls,
    packaging: value.packaging,
    files,
  };
  if (entry.packaging === "file") {
    const file = entry.files[0];
    if (entry.files.length !== 1 || file === undefined) {
      throw new ManifestParseError(`component ${entry.id} file packaging requires one file`);
    }
    if (file.sha256 !== entry.sha256 || file.sizeBytes !== entry.sizeBytes) {
      throw new ManifestParseError(`component ${entry.id} file digest must match the payload`);
    }
  }
  return entry;
}

export function readManifest(value: unknown): ComponentManifest {
  if (!isRecord(value) || typeof value.keyId !== "string" || !Array.isArray(value.components)) {
    throw new ManifestParseError("manifest shape is invalid");
  }
  if (value.components.length === 0) throw new ManifestParseError("manifest lists no components");
  const components = value.components.map((entry) => readComponent(entry));
  const ids = new Set<string>();
  for (const component of components) {
    if (ids.has(component.id)) throw new ManifestParseError(`duplicate component ${component.id}`);
    ids.add(component.id);
  }
  return { keyId: value.keyId, components };
}

export function verifyAndReadManifest(
  text: string,
  publicKeyRaw: Uint8Array,
  expectedKeyId: string,
): ComponentManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    void error;
    throw new ManifestParseError("manifest JSON is invalid");
  }
  if (!isRecord(parsed) || typeof parsed.signature !== "string" || !isRecord(parsed.manifest)) {
    throw new InvalidManifestSignatureError("manifest envelope is unsigned");
  }
  verifyManifestSignature(parsed.manifest, parsed.signature, publicKeyRaw, expectedKeyId);
  return readManifest(parsed.manifest);
}

export function assertComponentPin(entry: ComponentManifestEntry): void {
  if (entry.version.trim().toLowerCase() === "latest") {
    throw new UnpinnedLatestUrlError(`${entry.id} version is unpinned latest`);
  }
  const digestOk = SHA256_HEX.test(entry.sha256);
  const urls = [entry.primaryUrl, ...entry.mirrorUrls];
  for (const url of urls) {
    if (isMutableLatestUrl(url) && !digestOk) {
      throw new UnpinnedLatestUrlError(url);
    }
  }
  if (!digestOk) throw new MissingComponentDigestError(entry.id);
  for (const file of entry.files) {
    if (!SHA256_HEX.test(file.sha256)) {
      throw new MissingComponentDigestError(`${entry.id}:${file.path}`);
    }
  }
}
