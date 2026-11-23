#!/usr/bin/env node
import path from "node:path";
import { auditAsarFile, resolveAsarPath } from "./lib/asar-audit.mjs";
import { MissingCodeSigningCredentialsError } from "./lib/integrity-manifest.mjs";
import { defaultOutputRoot } from "./lib/paths.mjs";
import { assertReleaseSigningCredentials, signPeFiles } from "./lib/signing.mjs";
import { stageWindowsPackage } from "./lib/staging.mjs";

function parseArgs(argv) {
  let mode = "unsigned-dev";
  let dirOnly = false;
  let outputRoot;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--unsigned-dev") mode = "unsigned-dev";
    else if (arg === "--release") mode = "release";
    else if (arg === "--dir") dirOnly = true;
    else if ((arg === "--output" || arg === "--outputRoot") && argv[i + 1]) {
      outputRoot = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return { mode, dirOnly, outputRoot };
}

async function main() {
  const { mode, dirOnly, outputRoot } = parseArgs(process.argv.slice(2));
  try {
    assertReleaseSigningCredentials(mode);
    const staged = await stageWindowsPackage({
      mode,
      dirOnly,
      outputRoot: outputRoot ?? defaultOutputRoot(),
    });
    const asarPath = resolveAsarPath(staged.unpacked);
    const audit = auditAsarFile(asarPath);
    if (!audit.ok) {
      for (const issue of audit.issues) {
        console.error(`build-win-nsis: ${issue}`);
      }
      process.exit(1);
    }
    if (mode === "release") {
      const files = [
        path.join(staged.unpacked, "EF Harness.exe"),
        path.join(staged.unpacked, "resources", "bin", "harnessd.exe"),
        path.join(staged.unpacked, "resources", "bin", "gitleaks.exe"),
      ];
      if (staged.installer?.path) files.push(staged.installer.path);
      signPeFiles(files);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode,
          unpacked: staged.unpacked,
          unpackedBytes: staged.unpackedBytes,
          installer: staged.installer ?? null,
        },
        null,
        0,
      ),
    );
  } catch (error) {
    if (error instanceof MissingCodeSigningCredentialsError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

export { stageWindowsPackage } from "./lib/staging.mjs";
export { verifyBundledBinaryIntegrity } from "./lib/integrity-manifest.mjs";
export { auditAsarFile, resolveAsarPath } from "./lib/asar-audit.mjs";