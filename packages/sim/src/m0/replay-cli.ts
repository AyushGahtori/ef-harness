import path from "node:path";
import { pathToFileURL } from "node:url";
import { minimizeFailingSeed } from "./minimizer.js";
import { replaySeed } from "./simulator.js";

function readSeed(argv: readonly string[]): number {
  const index = argv.indexOf("--seed");
  const raw = index >= 0 ? argv[index + 1] : undefined;
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error("usage: replay --seed <N>");
  }
  return Number(raw);
}

export async function runReplayCli(argv: readonly string[]): Promise<number> {
  const seed = readSeed(argv);
  const minimize = argv.includes("--minimize");
  if (minimize) {
    const reduced = await minimizeFailingSeed(seed);
    console.log(`seed ${seed} ${reduced.failed ? "FAIL" : "PASS"} events=${reduced.events} sha256=${reduced.traceHash}`);
    for (const violation of reduced.violations) console.log(`violation ${violation}`);
    return reduced.failed ? 1 : 0;
  }
  const run = await replaySeed(seed);
  console.log(`seed ${seed} ${run.passed ? "PASS" : "FAIL"} sha256=${run.traceHash} fault=${run.faultFired ?? "none"}`);
  for (const violation of run.violations) console.log(`violation ${violation}`);
  return run.passed ? 0 : 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  runReplayCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
