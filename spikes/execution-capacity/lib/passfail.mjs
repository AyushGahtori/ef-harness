import {
  COMMIT_CHARGE_ABORT_RATIO,
  HARD_PAGE_READS_PER_SEC_MAX,
  PROVISIONAL_POOLS,
  UI_INPUT_LATENCY_PASS_MS,
} from "./constants.mjs";

export { UI_INPUT_LATENCY_PASS_MS, HARD_PAGE_READS_PER_SEC_MAX, COMMIT_CHARGE_ABORT_RATIO };

/**
 * A cell passes only when UI p95 is strictly under 50 ms and hard page reads
 * stay under the swapping threshold. Commit charge above 90% is an OOM abort,
 * which is a different verdict from a latency failure.
 *
 * @param {{
 *   uiInputLatencyP95Ms: number | null,
 *   hardPageReadsPerSecMedian: number | null,
 *   commitChargeRatio: number | null,
 *   oomGuardTripped?: boolean,
 *   availability?: string,
 * }} metrics
 */
export function judgeCell(metrics) {
  if (metrics.availability === "not_available_on_host") return "not_available_on_host";
  if (metrics.oomGuardTripped === true) return "FAIL_OOM_GUARD";
  if (metrics.commitChargeRatio !== null && metrics.commitChargeRatio > COMMIT_CHARGE_ABORT_RATIO) {
    return "FAIL_OOM_GUARD";
  }
  if (metrics.uiInputLatencyP95Ms === null || metrics.hardPageReadsPerSecMedian === null) {
    return "FAIL";
  }
  const uiPass = metrics.uiInputLatencyP95Ms < UI_INPUT_LATENCY_PASS_MS;
  const swapPass = metrics.hardPageReadsPerSecMedian < HARD_PAGE_READS_PER_SEC_MAX;
  return uiPass && swapPass ? "PASS" : "FAIL";
}

/**
 * Largest measured PASS along one axis. Missing cells are not failures.
 * A FAIL at a smaller width disqualifies larger widths.
 *
 * @param {readonly { width: number, verdict: string }[]} results
 */
export function largestPassingWidth(results) {
  const measured = results.filter((row) => row.verdict === "PASS" || row.verdict === "FAIL" || row.verdict === "FAIL_OOM_GUARD");
  const failing = measured.filter((row) => row.verdict !== "PASS").map((row) => row.width);
  const smallestFailure = failing.length > 0 ? Math.min(...failing) : null;
  const passing = measured
    .filter((row) => row.verdict === "PASS" && (smallestFailure === null || row.width < smallestFailure))
    .map((row) => row.width);
  if (passing.length === 0) return null;
  return Math.max(...passing);
}

/**
 * Keep provisional defaults when a wider setting was not measured.
 * Never raise a width past a measured failure. An unmeasured RAM class
 * keeps its provisional numbers.
 *
 * @param {"16gb" | "32gb"} ramClass
 * @param {"thinking" | "execution" | "heavyLane" | "sessionProcess"} axis
 * @param {readonly { width: number, verdict: string }[]} results
 * @param {"direct" | "scale_annotation" | "not_measured_on_host"} measurementMode
 */
export function recommendWidth(ramClass, axis, results, measurementMode) {
  const provisional = PROVISIONAL_POOLS[ramClass][axis];
  if (typeof provisional !== "number") {
    throw new Error(`axis ${axis} is not a numeric pool width`);
  }
  if (measurementMode === "not_measured_on_host") {
    return {
      provisional,
      measured: null,
      recommended: provisional,
      basis: "provisional_not_measured_on_host",
    };
  }
  if (results.length === 0) {
    return {
      provisional,
      measured: null,
      recommended: provisional,
      basis: "provisional_not_run",
    };
  }
  const measured = largestPassingWidth(results);
  if (measured === null) {
    return {
      provisional,
      measured: null,
      recommended: provisional,
      basis: "provisional_no_passing_cell",
    };
  }
  const widths = new Set(
    results
      .filter((row) => row.verdict === "PASS" || row.verdict === "FAIL" || row.verdict === "FAIL_OOM_GUARD")
      .map((row) => row.width),
  );
  const sawFailure = results.some((row) => row.verdict === "FAIL" || row.verdict === "FAIL_OOM_GUARD");
  if (sawFailure) {
    return {
      provisional,
      measured,
      recommended: measured,
      basis: "measured_largest_pass_below_failure",
    };
  }
  if (!widths.has(provisional) && measured < provisional) {
    return {
      provisional,
      measured,
      recommended: provisional,
      basis:
        measurementMode === "scale_annotation"
          ? "provisional_scale_annotation_wider_width_unmeasured"
          : "provisional_wider_width_unmeasured",
    };
  }
  return {
    provisional,
    measured,
    recommended: measured,
    basis: measurementMode === "scale_annotation" ? "measured_under_scale_annotation" : "measured",
  };
}
