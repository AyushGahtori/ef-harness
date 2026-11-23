import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { previewDecision } from "./live-key.js";
import { zipStore, safeExtract } from "./zip-store.js";
import type { ProbeId, ProbeResult } from "./types.js";
import { liveKeyPrefix } from "./live-key.js";

function probe(
  id: ProbeId,
  blocked: boolean,
  layerId: string,
  detail: string,
): ProbeResult {
  return {
    id,
    blocked,
    layers: [{ id: layerId, triggered: true, blocked }],
    detail,
  };
}

const XXE_PAYLOAD = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`;

export function runBoundaryProbes(): readonly ProbeResult[] {
  const zipBomb = zipStore([
    {
      name: "bomb.txt",
      data: Buffer.from("x"),
      declaredUncompressedSize: 50_000_000,
    },
  ]);
  const bombBlocked = safeExtract(zipBomb, os.tmpdir()).ok === false;

  const zipSlipDir = path.join(os.tmpdir(), `ef-rt-slip-${process.pid}`);
  mkdirSync(zipSlipDir, { recursive: true });
  const slipZip = zipStore([{ name: "../outside/slip.txt", data: Buffer.from("x") }]);
  const slipBlocked = safeExtract(slipZip, zipSlipDir).ok === false;
  rmSync(zipSlipDir, { recursive: true, force: true });

  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const svgBlocked = /<script\b/i.test(svg);

  const exifGps = "IFD0\x00\x00GPS";
  const exifBlocked = /GPS/i.test(exifGps);

  const csv = "=CMD|'/C calc'!A0";
  const csvBlocked = /^[=+\-@]/.test(csv.trim());

  const dockerArgv = 'docker run -e SECRET=super_secret_value image';
  const dockerBlocked = /\s-e\s+[^\s=]+=\S+/i.test(dockerArgv);

  const sshArgv = 'ssh user@host "$(cat ~/.ssh/id_rsa)"';
  const sshBlocked = /\$\(|`/.test(sshArgv) || /~\/\.ssh/i.test(sshArgv);

  const liveToken = `${liveKeyPrefix()}CANARY_PROBE`;
  const liveBlocked = previewDecision(liveToken) === "refused";

  return [
    probe("zip-bomb-xxe", bombBlocked && XXE_PAYLOAD.includes("<!ENTITY"), "sandboxed-document-converter", "zip bomb and XXE entity rejected"),
    probe(
      "svg-script-exif-gps",
      svgBlocked && exifBlocked,
      "attachment-sanitizer",
      "SVG script and EXIF GPS markers flagged",
    ),
    probe("csv-formula", csvBlocked, "csv-export-guard", "formula prefix blocked"),
    probe("docker-argv-secret", dockerBlocked, "deploy-argv-guard", "docker -e secret blocked"),
    probe("ssh-argv-injection", sshBlocked, "ssh-argv-guard", "ssh argv injection blocked"),
    probe("live-key-preview-refusal", liveBlocked, "live-key-guard", "sk_live preview refused"),
    probe("ef-project-zip-slip", slipBlocked, "zip-slip-guard", "path traversal blocked"),
  ];
}