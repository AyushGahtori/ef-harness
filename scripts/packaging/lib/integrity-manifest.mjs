import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical-json.mjs";
import { exportEd25519PublicKeyRaw, signEd25519, verifyEd25519 } from "./ed25519.mjs";
import { walkFiles } from "./paths.mjs";

export const BUNDLED_INTEGRITY_KEY_ID = "ef-harness-integrity-2026";

/** Release pin placeholder; unsigned-dev builds ship publicKey in integrity-manifest.meta.json. */
export const BUNDLED_INTEGRITY_PUBLIC_KEY_BASE64 =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export class MissingCodeSigningCredentialsError extends Error {
  constructor(message) {
    super(message);
    this.name = "MissingCodeSigningCredentialsError";
  }
}

export class IntegrityManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntegrityManifestError";
  }
}

export function resolveIntegrityPublicKeyRaw(resourcesRoot) {
  const metaPath = path.join(resourcesRoot, "integrity-manifest.meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (typeof meta.publicKeyBase64 === "string") {
      const raw = Buffer.from(meta.publicKeyBase64, "base64");
      if (raw.length === 32) return raw;
    }
  }
  const fromEnv = process.env.EF_INTEGRITY_MANIFEST_PUBLIC_KEY_BASE64;
  const raw = Buffer.from(fromEnv ?? BUNDLED_INTEGRITY_PUBLIC_KEY_BASE64, "base64");
  if (raw.length !== 32) {
    throw new IntegrityManifestError("integrity public key must be 32 bytes");
  }
  return raw;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * @param {string} resourcesRoot absolute path to resources/ (extraResources tree)
 */
export function buildIntegrityManifestPayload(resourcesRoot) {
  const files = walkFiles(resourcesRoot, (full) => {
    const base = path.basename(full);
    return base !== "integrity-manifest.json" && base !== "integrity-manifest.meta.json";
  }).map((full) => {
    const rel = path.relative(resourcesRoot, full).replaceAll("\\", "/");
    const stat = fs.statSync(full);
    return {
      path: rel,
      sha256: sha256File(full),
      sizeBytes: stat.size,
    };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    keyId: BUNDLED_INTEGRITY_KEY_ID,
    generatedAt: new Date().toISOString(),
    files,
  };
}

function resolveSigningPrivateKey(mode) {
  const pem = process.env.EF_INTEGRITY_MANIFEST_SIGNING_KEY_PEM;
  if (pem) {
    return crypto.createPrivateKey(pem);
  }
  if (mode === "unsigned-dev") {
    return crypto.generateKeyPairSync("ed25519").privateKey;
  }
  throw new MissingCodeSigningCredentialsError(
    "EF_INTEGRITY_MANIFEST_SIGNING_KEY_PEM is required for release integrity signing",
  );
}

export function writeIntegrityManifest(resourcesRoot, options = {}) {
  const mode = options.mode ?? "unsigned-dev";
  const payload = buildIntegrityManifestPayload(resourcesRoot);
  const privateKey = options.privateKey ?? resolveSigningPrivateKey(mode);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicRaw = exportEd25519PublicKeyRaw(publicKey);
  const signature = signEd25519(
    privateKey,
    Buffer.from(canonicalJson(payload), "utf8"),
  ).toString("base64");
  const envelope = { manifest: payload, signature };
  const manifestPath = path.join(resourcesRoot, "integrity-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  const metaPath = path.join(resourcesRoot, "integrity-manifest.meta.json");
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify(
      {
        publicKeyBase64: publicRaw.toString("base64"),
        keyId: BUNDLED_INTEGRITY_KEY_ID,
        mode,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { manifestPath, metaPath, envelope, payload, publicRaw };
}

export function verifyIntegrityManifest(resourcesRoot, envelope = undefined) {
  const manifestPath = path.join(resourcesRoot, "integrity-manifest.json");
  const parsed = envelope ?? JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!parsed?.manifest || typeof parsed.signature !== "string") {
    throw new IntegrityManifestError("integrity-manifest.json envelope is invalid");
  }
  if (parsed.manifest.keyId !== BUNDLED_INTEGRITY_KEY_ID) {
    throw new IntegrityManifestError("integrity manifest key id mismatch");
  }
  const publicKeyRaw = resolveIntegrityPublicKeyRaw(resourcesRoot);
  const message = Buffer.from(canonicalJson(parsed.manifest), "utf8");
  const sig = Buffer.from(parsed.signature, "base64");
  if (!verifyEd25519(publicKeyRaw, message, sig)) {
    throw new IntegrityManifestError("integrity manifest Ed25519 signature rejected");
  }
  const missing = [];
  const tampered = [];
  let matched = 0;
  for (const entry of parsed.manifest.files) {
    const full = path.join(resourcesRoot, entry.path);
    if (!fs.existsSync(full)) {
      missing.push(entry.path);
      continue;
    }
    if (sha256File(full) !== entry.sha256) {
      tampered.push(entry.path);
      continue;
    }
    matched += 1;
  }
  const total = parsed.manifest.files.length;
  return {
    total,
    matched,
    percent: total === 0 ? 100 : Math.round((matched / total) * 100),
    missing,
    tampered,
    ok: missing.length === 0 && tampered.length === 0,
  };
}

/** BundledBinaryIntegrityManifest — verify at harnessd startup (Task 132 AV repair hooks). */
export function verifyBundledBinaryIntegrity(resourcesRoot) {
  const result = verifyIntegrityManifest(resourcesRoot);
  if (!result.ok) {
    const parts = [];
    if (result.missing.length) parts.push(`missing: ${result.missing.join(", ")}`);
    if (result.tampered.length) parts.push(`tampered: ${result.tampered.join(", ")}`);
    throw new IntegrityManifestError(`Bundled binary integrity failed (${parts.join("; ")})`);
  }
  return result;
}