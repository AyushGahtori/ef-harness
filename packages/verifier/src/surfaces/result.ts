import { z, type ZodType } from "zod";
import type {
  CheckResultRow,
  CheckStatus,
  FailureAttribution,
  SurfaceCheckResult,
  SurfaceVerifierContext,
} from "./types.js";

export function surfaceResult(input: {
  readonly checkId: string;
  readonly status: CheckStatus;
  readonly context: SurfaceVerifierContext;
  readonly message?: string;
  readonly attribution?: FailureAttribution;
  readonly details?: Readonly<Record<string, unknown>>;
}): SurfaceCheckResult {
  const recordedAt = input.context.recordedAt ?? Date.now();
  const receipt: Record<string, unknown> = {
    attempt: input.context.attemptId,
    check_version: input.context.checkVersion,
    artifact_digest: input.context.artifactDigest,
    recorded_at: recordedAt,
    ...(input.details ?? {}),
  };
  if (input.attribution === "environment") {
    receipt.affectsWorkerQualityScore = false;
  }
  const result: SurfaceCheckResult = {
    check_id: input.checkId,
    status: input.status,
    receipt,
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.attribution !== undefined ? { attribution: input.attribution } : {}),
  };
  return result;
}

export function withAttribution(
  result: SurfaceCheckResult,
  attribution: FailureAttribution,
): SurfaceCheckResult {
  if (attribution === "environment") {
    return {
      ...result,
      attribution,
      receipt: { ...result.receipt, affectsWorkerQualityScore: false },
    };
  }
  return { ...result, attribution };
}

export function toCheckResultRow(
  result: SurfaceCheckResult,
  context: SurfaceVerifierContext,
): CheckResultRow {
  const recordedAt = Number(result.receipt.recorded_at ?? context.recordedAt ?? Date.now());
  return {
    check_id: result.check_id,
    attempt: context.attemptId,
    check_version: context.checkVersion,
    artifact_digest: context.artifactDigest,
    status: result.status,
    receipt: JSON.stringify(result.receipt),
    recorded_at: recordedAt,
  };
}

export function environmentFailure(
  checkId: string,
  context: SurfaceVerifierContext,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): SurfaceCheckResult {
  return withAttribution(
    surfaceResult({
      checkId,
      status: "error",
      context,
      message,
      ...(details ? { details } : {}),
    }),
    "environment",
  );
}

export function implementationFailure(
  checkId: string,
  context: SurfaceVerifierContext,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): SurfaceCheckResult {
  return withAttribution(
    surfaceResult({
      checkId,
      status: "fail",
      context,
      message,
      ...(details ? { details } : {}),
    }),
    "implementation",
  );
}

export function parseCheck<T>(
  schema: ZodType<T>,
  spec: unknown,
  context: SurfaceVerifierContext,
): { ok: true; value: T } | { ok: false; results: SurfaceCheckResult[] } {
  const peek = z.object({ checkId: z.string().min(1) }).safeParse(spec);
  const checkId = peek.success ? peek.data.checkId : "invalid-spec";
  const parsed = schema.safeParse(spec);
  if (!parsed.success) {
    return {
      ok: false,
      results: [
        withAttribution(
          surfaceResult({
            checkId,
            status: "error",
            context,
            message: parsed.error.message,
          }),
          "contract_mismatch",
        ),
      ],
    };
  }
  return { ok: true, value: parsed.data };
}

export function passing(
  checkId: string,
  context: SurfaceVerifierContext,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): SurfaceCheckResult {
  return surfaceResult({
    checkId,
    status: "pass",
    context,
    message,
    ...(details ? { details } : {}),
  });
}
