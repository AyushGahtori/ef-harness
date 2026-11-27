export class SchedulerError extends Error {
  readonly code:
    | "cycle"
    | "invalid_graph"
    | "unknown_task"
    | "time_went_backwards"
    | "no_eligible_model";

  constructor(code: SchedulerError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "SchedulerError";
  }
}

export function at<T>(items: readonly T[], index: number, label: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new SchedulerError("invalid_graph", `Missing ${label} at index ${index}`);
  }
  return value;
}
