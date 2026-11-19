import { PROVISIONAL_POOLS } from "./constants.mjs";
import { judgeCell, recommendWidth } from "./passfail.mjs";
import { measurementMode } from "./pressure.mjs";
import { assertFootprints, assertMachineProfile, footprintRow, machineProfileRow } from "./schema.mjs";

/**
 * @param {string} verdict
 */
function severity(verdict) {
  if (verdict === "FAIL_OOM_GUARD") return 3;
  if (verdict === "FAIL") return 2;
  if (verdict === "PASS") return 1;
  return 0;
}

/**
 * @param {readonly { width: number, verdict: string }[]} rows
 */
function worstByWidth(rows) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const row of rows) {
    const current = map.get(row.width);
    if (!current || severity(row.verdict) > severity(current)) map.set(row.width, row.verdict);
  }
  return [...map.entries()].map(([width, verdict]) => ({ width, verdict }));
}

/**
 * @param {{ hostMb: number, cells: readonly { isolationMode: string, load: string, thinkingWidth: number, executingWidth: number, verdict: string }[], heavy: { rows: readonly { width: number, uiInputLatencyP95Ms: number | null, commitChargeRatio: number, hardPageReadsPerSec: number }[] } }} input
 */
export function recommendPools(input) {
  const classes = {
    "16gb": measurementMode(input.hostMb, 16),
    "32gb": measurementMode(input.hostMb, 32),
  };
  const thinkingRows = worstByWidth(
    input.cells
      .filter((cell) => cell.isolationMode === "own_loop" && cell.load === "idle" && cell.verdict !== "not_available_on_host")
      .map((cell) => ({ width: cell.thinkingWidth, verdict: cell.verdict })),
  );
  const executionRows = worstByWidth(
    input.cells
      .filter((cell) => cell.isolationMode === "own_loop" && cell.load === "active" && cell.verdict !== "not_available_on_host")
      .map((cell) => ({ width: cell.executingWidth, verdict: cell.verdict })),
  );
  const sessionRows = worstByWidth(
    input.cells
      .filter((cell) => cell.isolationMode === "session_process" && cell.load === "active" && cell.verdict !== "not_available_on_host")
      .map((cell) => ({ width: cell.thinkingWidth, verdict: cell.verdict })),
  );
  const heavyRows = input.heavy.rows.map((row) => ({
    width: row.width,
    verdict: judgeCell({
      uiInputLatencyP95Ms: row.uiInputLatencyP95Ms,
      hardPageReadsPerSecMedian: row.hardPageReadsPerSec,
      commitChargeRatio: row.commitChargeRatio,
    }),
  }));
  /** @type {Record<string, unknown>} */
  const pools = {};
  for (const ramClass of ["16gb", "32gb"]) {
    const mode = classes[ramClass];
    pools[ramClass] = {
      measurementMode: mode,
      thinking: recommendWidth(ramClass, "thinking", mode === "direct" ? thinkingRows : [], mode),
      execution: recommendWidth(ramClass, "execution", mode === "direct" ? executionRows : [], mode),
      heavyLane: recommendWidth(ramClass, "heavyLane", mode === "direct" ? heavyRows : [], mode),
      sessionProcess: recommendWidth(ramClass, "sessionProcess", mode === "direct" ? sessionRows : [], mode),
      services: {
        provisional: PROVISIONAL_POOLS[ramClass].services,
        measured: null,
        recommended: PROVISIONAL_POOLS[ramClass].services,
        basis: "provisional_service_processes_not_hosted_in_this_spike",
      },
    };
  }
  return pools;
}

/**
 * @param {Record<string, unknown>} result
 */
export function toCalibratedDefaults(result) {
  const measuredAt = Number(result.generatedAt);
  const host = result.host;
  const machineProfile = [
    machineProfileRow("ram_total_mb", String(host.totalMb), measuredAt),
    machineProfileRow("cores", String(host.cores), measuredAt),
    machineProfileRow("gpu", String(host.gpu), measuredAt),
    machineProfileRow("dev_drive", String(host.devDrive), measuredAt),
    machineProfileRow(
      "calibration_run",
      JSON.stringify({
        quick: result.quick,
        osBuild: host.osBuild,
        fileSystem: host.fileSystem,
        warnings: result.warnings,
      }),
      measuredAt,
    ),
  ];
  const serviceMb = Math.max(0, Math.round(Number(result.service?.workingSetBytes ?? 0) / (1024 * 1024)));
  const buildMb = Math.max(
    0,
    ...result.heavy.rows.map((row) => Math.round(Number(row.commitSpikeBytes ?? 0) / (1024 * 1024))),
  );
  const browserMb = Math.max(0, Math.round(Number(result.browserBytes ?? result.service?.workingSetBytes ?? 0) / (1024 * 1024)));
  const footprints = [
    footprintRow({ consumer: "worker_cli", p50Mb: serviceMb, p95Mb: serviceMb, samples: 1, updatedAt: measuredAt }),
    footprintRow({ consumer: "dev_server", p50Mb: serviceMb, p95Mb: serviceMb, samples: 1, updatedAt: measuredAt }),
    footprintRow({
      consumer: "build",
      p50Mb: buildMb,
      p95Mb: buildMb,
      samples: Math.max(1, result.heavy.rows.length),
      updatedAt: measuredAt,
    }),
    footprintRow({ consumer: "browser", p50Mb: browserMb, p95Mb: browserMb, samples: 1, updatedAt: measuredAt }),
  ];
  assertMachineProfile(machineProfile);
  assertFootprints(footprints);
  return {
    schema: {
      machine_profile: ["key", "value", "measured_at"],
      footprints: ["consumer", "project", "p50_mb", "p95_mb", "samples", "updated_at"],
    },
    machine_profile: machineProfile,
    footprints,
    pools: result.pools,
    axes: { thinking: "thinkingWidth", executing: "executingWidth" },
    passCriterion: {
      uiInputLatencyP95Ms: 50,
      comparison: "strictly_less_than",
      hardPageReadsPerSec: 50,
      commitChargeAbortRatio: 0.9,
    },
    cells: result.cells,
    heavyLane: result.heavy,
    acl: result.acl,
    slotReset: result.slotReset,
    tiers: result.tiers,
    warnings: result.warnings,
    host,
    measurementModes: result.measurementModes,
    provisional: result.provisional,
    modes: result.modes,
    collectors: result.collectors,
  };
}

/**
 * @param {Record<string, any>} pools
 * @param {"16gb" | "32gb"} ramClass
 */
function describeClass(pools, ramClass) {
  const pool = pools[ramClass];
  const lines = [];
  for (const axis of ["thinking", "execution", "heavyLane", "sessionProcess"]) {
    const row = pool[axis];
    lines.push(
      `- **${axis}:** provisional ${row.provisional}, measured ${row.measured === null ? "none" : row.measured}, recommended ${row.recommended} (${row.basis}).`,
    );
  }
  const services = pool.services;
  lines.push(
    `- **services:** provisional ${services.provisional.environments} environments plus preview, measured none, recommended ${services.recommended.environments} environments plus preview (${services.basis}).`,
  );
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} result
 */
export function renderReport(result) {
  const defaults = toCalibratedDefaults(result);
  const host = result.host;
  const lines = [
    "# Execution capacity spike",
    "",
    `Measured on ${host.osProduct} build ${host.osBuild}, ${host.totalMb} MB RAM, ${host.cores} cores, filesystem ${host.fileSystem}.`,
    `Dev Drive column: \`${host.devDrive}\`. GPU: ${host.gpu}.`,
    "",
    "## Three pools stay separate",
    "",
    "Thinking width and executing width are different axes. An own-loop cell can have many in-process thinking slots and a small warm execution pool. A session-process cell keeps one process tree per session, so its thinking count and executing count are recorded separately even when the numbers match.",
    "",
    "## Provisional versus measured widths",
    "",
    "### 16 GB",
    "",
    describeClass(result.pools, "16gb"),
    "",
    "### 32 GB",
    "",
    describeClass(result.pools, "32gb"),
    "",
    "A RAM class that this host cannot represent directly keeps the provisional defaults. A larger host must not be treated as 16 GB headroom; that class uses scale annotation and stays conservative when the provisional width was not measured under pressure.",
    "",
    "## Pass rule",
    "",
    "A cell is `PASS` only when UI input-to-paint p95 is strictly under 50 ms and hard page reads (`Memory\\Page Reads/sec`) stay under 50. Commit charge above 90% is `FAIL_OOM_GUARD`.",
    "",
    "## Cells",
    "",
    "| Mode | Load | Thinking | Executing | Verdict |",
    "| --- | --- | --- | --- | --- |",
    ...result.cells.map(
      (cell) =>
        `| ${cell.isolationMode} | ${cell.load} | ${cell.thinkingWidth} | ${cell.executingWidth} | ${cell.verdict} |`,
    ),
    "",
    "## Heavy lane",
    "",
    ...result.heavy.rows.map(
      (row) =>
        `- Width ${row.width}: UI p95 ${row.uiInputLatencyP95Ms ?? "unmeasured"} ms, commit ratio ${row.commitChargeRatio}, spike ${row.commitSpikeBytes} bytes.`,
    ),
    "",
    "## ACL and slot reset",
    "",
    `Empty-folder grant ${Math.round(result.acl.empty.ms)} ms (disk queue ${result.acl.empty.diskQueueLength}). Recursive grant over ${result.acl.fileCount} files ${Math.round(result.acl.afterTree.ms)} ms (disk queue ${result.acl.afterTree.diskQueueLength}).`,
    `Cold slot create ${Math.round(result.slotReset.coldCreateMs)} ms. Reused slot \`git checkout\` + clean ${Math.round(result.slotReset.reuseResetMs)} ms.`,
    "",
    "## Collection APIs",
    "",
    "- Committed memory: `GlobalMemoryStatusEx` (`ullTotalPageFile - ullAvailPageFile`).",
    "- Working set: `Win32_PerfFormattedData_PerfProc_Process` where `Name='_Total'`, property `WorkingSet`.",
    "- CPU: `GetSystemTimes` idle, kernel, and user deltas over 200 ms.",
    "- Disk active time and queue: `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` where `Name='_Total'`, `PercentIdleTime` and `CurrentDiskQueueLength`.",
    "- Hard page faults: `Win32_PerfFormattedData_PerfOS_Memory` property `PageReadsPersec`.",
    "- Defender CPU: `Get-Process MsMpEng` `TotalProcessorTime` over 200 ms, divided by elapsed time and logical core count. No exclusion is written.",
    "- Dev Drive: `fsutil devdrv query`, with `Win32_LogicalDisk.FileSystem` when that query is denied. A denied or non-Dev-Drive volume is `not_available_on_host` and the NTFS run continues.",
    "- UI input-to-paint: an Electron `BrowserWindow` sends a pointer input and records `requestAnimationFrame` time minus the input timestamp. The first frame is a warm-up.",
    "- Sandbox launch: time to ready for a worker inside a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`).",
    "- Slot reset: cold `git init` plus commit, versus `git checkout -- .` and `git clean -fd` on the reused slot.",
    "",
    "## What this spike did not change",
    "",
    "Defender exclusions were not added. WSL settings were not edited. Template commands ran offline from the local tree and a hard-linked store file.",
    "",
    "## Warnings",
    "",
    result.warnings.length > 0 ? result.warnings.map((warning) => `- ${warning}`).join("\n") : "None.",
    "",
  ];
  return { markdown: lines.join("\n"), defaults };
}
