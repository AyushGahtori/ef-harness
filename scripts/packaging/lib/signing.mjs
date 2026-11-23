import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MissingCodeSigningCredentialsError } from "./integrity-manifest.mjs";

export function hasAuthenticodeCredentials() {
  return Boolean(
    process.env.EF_CODE_SIGNING_CERT_THUMBPRINT ||
      process.env.AZURE_TRUSTED_SIGNING_ACCOUNT ||
      process.env.WINDOWS_SIGNING_CERTIFICATE_FILE,
  );
}

export function assertReleaseSigningCredentials(mode) {
  if (mode !== "release") return;
  if (!hasAuthenticodeCredentials()) {
    throw new MissingCodeSigningCredentialsError(
      "release packaging requires EF_CODE_SIGNING_CERT_THUMBPRINT, AZURE_TRUSTED_SIGNING_ACCOUNT, or WINDOWS_SIGNING_CERTIFICATE_FILE",
    );
  }
}

/**
 * @param {string[]} files absolute paths to sign
 */
export function signPeFiles(files) {
  const thumb = process.env.EF_CODE_SIGNING_CERT_THUMBPRINT;
  if (thumb) {
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const args = [
        "sign",
        "/fd",
        "SHA256",
        "/tr",
        "http://timestamp.digicert.com",
        "/td",
        "SHA256",
        "/sha1",
        thumb,
        file,
      ];
      const result = spawnSync("signtool", args, { encoding: "utf8", windowsHide: true });
      if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || "signtool failed").trim());
      }
    }
    return { provider: "signtool", signed: files.length };
  }
  if (process.env.EF_PACKAGING_SIGNING_FIXTURE === "1") {
    const stampDir = path.join(path.dirname(files[0] ?? "."), ".signing-fixture");
    fs.mkdirSync(stampDir, { recursive: true });
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      fs.writeFileSync(
        path.join(stampDir, `${path.basename(file)}.fixture.sig.json`),
        `${JSON.stringify({ file, signedAt: new Date().toISOString(), rfc3161: true }, null, 2)}\n`,
      );
    }
    return { provider: "fixture", signed: files.length };
  }
  throw new MissingCodeSigningCredentialsError("no code-signing credentials available");
}