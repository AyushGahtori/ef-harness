import { spawn } from "node:child_process";
import { tscPath, viteBin } from "./paths.mjs";
import { percentile } from "./stats.mjs";

/**
 * @param {string} file
 * @param {readonly string[]} args
 * @param {string} cwd
 */
function run(file, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stderr: `${stdout}\n${stderr}`.slice(0, 500) }));
  });
}

/**
 * @param {{ widths: readonly number[], slotDir: string, sample: () => Promise<Record<string, unknown>>, measureUi: ((samples: number) => Promise<{ p95Ms: number } | null>) | null, uiSamples: number }} options
 */
export async function measureHeavyLane(options) {
  const tsc = tscPath();
  const vite = viteBin();
  const rows = [];
  for (const width of options.widths) {
    const before = await options.sample();
    const started = performance.now();
    const codes = await Promise.all(
      Array.from({ length: width }, async (_, index) => {
        const typecheck = await run(tsc, ["--noEmit", "-p", "tsconfig.json"], options.slotDir);
        const bundle = vite
          ? await run(vite, ["build", "--config", "vite.config.mjs", "--outDir", `dist-heavy-${index}`], options.slotDir)
          : { code: 127, stderr: "vite missing" };
        return [typecheck, bundle];
      }),
    );
    const elapsedMs = performance.now() - started;
    const after = await options.sample();
    let ui = null;
    if (options.measureUi) {
      try {
        ui = await options.measureUi(options.uiSamples);
      } catch {
        ui = null;
      }
    }
    const commitBefore = Number(before.commitCharge ?? 0);
    const commitAfter = Number(after.commitCharge ?? 0);
    rows.push({
      width,
      elapsedMs,
      commitBefore,
      commitAfter,
      commitSpikeBytes: Math.max(0, commitAfter - commitBefore),
      commitChargeRatio: Number(after.commitRatio ?? 0),
      hardPageReadsPerSec: Number(after.pageReadsPerSec ?? 0),
      uiInputLatencyP95Ms: ui ? ui.p95Ms : null,
      tscCodes: codes.map((pair) => pair[0].code),
      viteCodes: codes.map((pair) => pair[1].code),
      toolErrors: codes.map((pair) => `${pair[0].stderr} ${pair[1].stderr}`.trim()).filter(Boolean),
      viteAvailable: vite !== null,
    });
  }
  const passing = rows.filter(
    (row) => row.uiInputLatencyP95Ms !== null && row.uiInputLatencyP95Ms < 50 && row.commitChargeRatio <= 0.9,
  );
  return {
    rows,
    largestPassing: passing.length > 0 ? Math.max(...passing.map((row) => row.width)) : null,
    uiSamples: rows.map((row) => row.uiInputLatencyP95Ms).filter((value) => value !== null),
    p95OfJitter: rows.some((row) => row.uiInputLatencyP95Ms !== null)
      ? percentile(
          rows.map((row) => row.uiInputLatencyP95Ms).filter((value) => value !== null),
          95,
        )
      : null,
  };
}
