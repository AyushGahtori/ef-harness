import { FAULT_CLASSES, TX_BOUNDARY_HOOKS, type FaultClass, type FaultCoverageMatrix, type TxBoundaryHook } from "./types.js";

export function emptyCoverageMatrix(): FaultCoverageMatrix {
  const hooks: Record<TxBoundaryHook, number> = Object.fromEntries(
    TX_BOUNDARY_HOOKS.map((h) => [h, 0]),
  ) as Record<TxBoundaryHook, number>;
  const classes: Record<FaultClass, number> = Object.fromEntries(
    FAULT_CLASSES.map((c) => [c, 0]),
  ) as Record<FaultClass, number>;
  return { hooks, classes, totalRuns: 0 };
}

export function recordFaultHit(
  matrix: FaultCoverageMatrix,
  hook: TxBoundaryHook | null,
  faultClass: FaultClass,
): FaultCoverageMatrix {
  const hooks = { ...matrix.hooks };
  const classes = { ...matrix.classes };
  if (hook) {
    hooks[hook] = (hooks[hook] ?? 0) + 1;
  }
  classes[faultClass] = (classes[faultClass] ?? 0) + 1;
  return { hooks, classes, totalRuns: matrix.totalRuns };
}

export function mergeCoverage(matrices: readonly FaultCoverageMatrix[]): FaultCoverageMatrix {
  const hooks: Record<TxBoundaryHook, number> = Object.fromEntries(
    TX_BOUNDARY_HOOKS.map((h) => [h, 0]),
  ) as Record<TxBoundaryHook, number>;
  const classes: Record<FaultClass, number> = Object.fromEntries(
    FAULT_CLASSES.map((c) => [c, 0]),
  ) as Record<FaultClass, number>;
  let totalRuns = 0;
  for (const matrix of matrices) {
    totalRuns += matrix.totalRuns;
    for (const hook of TX_BOUNDARY_HOOKS) {
      hooks[hook] = (hooks[hook] ?? 0) + (matrix.hooks[hook] ?? 0);
    }
    for (const cls of FAULT_CLASSES) {
      classes[cls] = (classes[cls] ?? 0) + (matrix.classes[cls] ?? 0);
    }
  }
  return { hooks, classes, totalRuns };
}

export function coverageReportJson(matrix: FaultCoverageMatrix): string {
  return JSON.stringify(
    {
      generatedAt: "virtual",
      totalRuns: matrix.totalRuns,
      hooks: matrix.hooks,
      classes: matrix.classes,
    },
    null,
    2,
  );
}