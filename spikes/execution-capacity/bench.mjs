import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HEAVY_LANE_WIDTHS, ISOLATION_MODES, LOAD_PROFILES, WORKER_COUNTS } from "./lib/constants.mjs";
import { renderReport } from "./lib/report.mjs";
import { runBenchmark } from "./lib/runner.mjs";

const spikeRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 */
function parse(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
  const values = new Map();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) values.set(match[1], match[2]);
  }
  const quick = flags.has("--quick");
  const list = (name, fallback) =>
    values.has(name)
      ? values
          .get(name)
          .split(",")
          .map((item) => (Number.isNaN(Number(item)) ? item : Number(item)))
      : fallback;
  return {
    quick,
    holdForSignal: flags.has("--hold-for-signal"),
    write: flags.has("--write"),
    workerCounts: list("workers", quick ? [1] : WORKER_COUNTS),
    loads: list("loads", quick ? LOAD_PROFILES : LOAD_PROFILES),
    modes: list("modes", quick ? ["own_loop", "tier_a", "tier_c", "tier_d"] : ISOLATION_MODES),
    samples: values.has("samples") ? Number(values.get("samples")) : quick ? 1 : 3,
    poolWidth: values.has("pool") ? Number(values.get("pool")) : 2,
    heavyWidths: list("heavy", quick ? [1] : HEAVY_LANE_WIDTHS),
    aclFiles: quick ? 24 : 500,
    uiSamples: quick ? 5 : 12,
    activeMax: values.has("active-max") ? Number(values.get("active-max")) : Number.POSITIVE_INFINITY,
    sessionMax: values.has("session-max") ? Number(values.get("session-max")) : Number.POSITIVE_INFINITY,
  };
}

const options = parse(process.argv.slice(2));
const result = await runBenchmark(options);
if (options.holdForSignal) {
  process.exit(0);
}
const rendered = renderReport(result);
if (options.write) {
  fs.writeFileSync(path.join(spikeRoot, "calibrated-defaults.json"), `${JSON.stringify(rendered.defaults, null, 2)}\n`);
  fs.writeFileSync(path.join(spikeRoot, "REPORT.md"), rendered.markdown);
}
process.stdout.write(`${JSON.stringify({ verdicts: result.cells.map((cell) => cell.verdict), warnings: result.warnings, devDrive: result.host.devDrive })}\n`);
