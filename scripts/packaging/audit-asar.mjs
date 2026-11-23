#!/usr/bin/env node
import path from "node:path";
import { auditAsarFile, resolveAsarPath } from "./lib/asar-audit.mjs";
import { defaultOutputRoot, winUnpackedDir } from "./lib/paths.mjs";

function parseArgs(argv) {
  let target;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--target" && argv[i + 1]) {
      target = argv[i + 1];
      i += 1;
    } else if (!argv[i].startsWith("-")) {
      target = argv[i];
    }
  }
  return { target };
}

function main() {
  const { target } = parseArgs(process.argv.slice(2));
  const resolved = target
    ? resolveAsarPath(path.resolve(target))
    : resolveAsarPath(winUnpackedDir(defaultOutputRoot()));
  const result = auditAsarFile(resolved);
  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(`audit-asar: ${issue}`);
    }
    process.exit(1);
  }
  console.log(`audit-asar ok (${resolved})`);
}

main();