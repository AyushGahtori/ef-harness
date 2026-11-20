import type { CompiledTaskStamp } from "./types.js";

export class UncompiledDispatchError extends Error {
  readonly code = "UNCOMPILED_DISPATCH" as const;
  constructor(
    message = "No coding task can enter READY without passing all 9 DeterministicGraphCompiler passes.",
  ) {
    super(message);
    this.name = "UncompiledDispatchError";
  }
}

export function taskMayEnterReady(
  stamp:
    | Pick<
        CompiledTaskStamp,
        "compiledSliceSha256" | "compiledAt" | "planEpoch" | "passedAllNinePasses" | "state"
      >
    | null
    | undefined,
): boolean {
  return Boolean(
    stamp &&
      stamp.state === "READY" &&
      stamp.passedAllNinePasses === true &&
      stamp.compiledSliceSha256.length > 0 &&
      stamp.compiledAt.length > 0 &&
      Number.isInteger(stamp.planEpoch),
  );
}

export function assertTaskReadyForDispatch(
  stamp: Parameters<typeof taskMayEnterReady>[0],
): void {
  if (!taskMayEnterReady(stamp)) throw new UncompiledDispatchError();
}
