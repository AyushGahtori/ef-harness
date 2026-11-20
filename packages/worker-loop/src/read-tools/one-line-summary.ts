export type OneLineEvent =
  | { readonly kind: "read"; readonly path: string; readonly start: number; readonly end: number }
  | { readonly kind: "read-binary"; readonly path: string; readonly bytes: number }
  | { readonly kind: "grep"; readonly pattern: string; readonly hits: number; readonly fileCount: number }
  | {
      readonly kind: "test";
      readonly passed: number;
      readonly failed: number;
      readonly failureLabel?: string;
      readonly artifactId: string;
    }
  | { readonly kind: "build"; readonly shown: number; readonly total: number; readonly artifactId: string }
  | { readonly kind: "list"; readonly glob: string; readonly count: number }
  | { readonly kind: "log"; readonly artifactId: string; readonly start: number; readonly end: number }
  | { readonly kind: "kb"; readonly id: string; readonly version: string };

/** Deterministic `turn_log.result_summary` line used verbatim by Task 054 compaction. */
export function oneLineSummary(event: OneLineEvent): string {
  switch (event.kind) {
    case "read":
      return `read ${event.path} L${event.start}-${event.end}`;
    case "read-binary":
      return `read ${event.path} binary ${event.bytes} bytes`;
    case "grep":
      return `grep "${event.pattern}": ${event.hits} hits in ${event.fileCount} files`;
    case "test": {
      const label = event.failed > 0 ? ` (${event.failureLabel ?? "failed"})` : "";
      return `test: ${event.passed} passed, ${event.failed} failed${label} [${event.artifactId}]`;
    }
    case "build":
      return `build: ${event.shown} of ${event.total} errors [${event.artifactId}]`;
    case "list":
      return `list ${event.glob}: ${event.count} files`;
    case "log":
      return `log ${event.artifactId} L${event.start}-${event.end}`;
    case "kb":
      return `kb ${event.id}@${event.version}`;
    default: {
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}
