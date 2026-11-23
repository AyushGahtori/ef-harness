import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./paths.mjs";

/**
 * @param {string} artifactRoot win-unpacked or installer directory
 * @param {{ appVersion?: string }} [options]
 */
export function writeSbomAndChecksums(artifactRoot, options = {}) {
  const appVersion = options.appVersion ?? "0.0.0-dev";
  const files = walkFiles(artifactRoot).filter((f) => !f.endsWith(".meta.json"));
  const components = [];
  const checksumLines = [];
  for (const full of files) {
    const rel = path.relative(artifactRoot, full).replaceAll("\\", "/");
    const stat = fs.statSync(full);
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(full));
    const digest = hash.digest("hex");
    checksumLines.push(`${digest}  ${rel}`);
    components.push({
      type: "file",
      name: rel,
      version: appVersion,
      hashes: [{ alg: "SHA-256", content: digest }],
      properties: [{ name: "sizeBytes", value: String(stat.size) }],
    });
  }
  checksumLines.sort();
  components.sort((a, b) => a.name.localeCompare(b.name));
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "EF Harness",
        version: appVersion,
      },
      tools: [{ name: "scripts/packaging/build-win-nsis.mjs" }],
    },
    components,
  };
  const sbomPath = path.join(artifactRoot, "sbom.cdx.json");
  const sumsPath = path.join(artifactRoot, "SHA256SUMS.txt");
  fs.writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  fs.writeFileSync(sumsPath, `${checksumLines.join("\n")}\n`, "utf8");
  return { sbomPath, sumsPath, componentCount: components.length };
}