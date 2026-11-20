import type { ZodType } from "zod";
import { sha256Hex } from "./hash.js";
import type { ModelCompletionResult, ModelProtocolAdapter } from "./ports.js";

export interface ShellInput {
  readonly user: string;
}

export interface ShellFeature {
  readonly id: string;
  readonly maxRetries: number;
  readonly costLimitMicros: number;
  readonly outputSchema: ZodType;
  assemblePrompt(input: ShellInput): string;
  parse(raw: string): { ok: true; value: unknown } | { ok: false; reason: string };
  fallback(input: ShellInput, reason: string): unknown;
}

export interface ShellReport {
  readonly status: "pass" | "fallback" | "cost_capped" | "shell_error";
  readonly value: unknown;
  readonly prompt: string;
  readonly promptHash: string;
  readonly attempts: number;
  readonly spentMicros: number;
  readonly judgeSpendMicros: 0;
  readonly elapsedMs: number;
  readonly warnings: readonly string[];
  readonly error?: string;
}

export async function runDeterministicShell(
  feature: ShellFeature,
  input: ShellInput,
  stub: ModelProtocolAdapter,
  warnings: readonly string[],
): Promise<ShellReport> {
  const started = performance.now();
  if (!Number.isInteger(feature.maxRetries) || feature.maxRetries < 0) {
    throw new Error("maxRetries must be a non-negative integer");
  }
  if (!Number.isInteger(feature.costLimitMicros) || feature.costLimitMicros < 0) {
    throw new Error("costLimitMicros must be a non-negative integer");
  }
  let prompt = "";
  try {
    prompt = feature.assemblePrompt(input);
  } catch (error) {
    return errorReport(prompt, 0, 0, started, warnings, error);
  }
  const promptHash = sha256Hex(prompt);
  const maxAttempts = feature.maxRetries + 1;
  let spent = 0;
  let lastReason = "model_output_rejected";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let result: ModelCompletionResult;
    try {
      result = await stub.complete({
        role: "generator",
        prompt,
        inputHash: promptHash,
      });
    } catch (error) {
      return errorReport(prompt, attempt, spent, started, warnings, error);
    }
    const remaining = feature.costLimitMicros - spent;
    if (result.stopReason === "over_budget" || result.costMicros > remaining) {
      return {
        status: "cost_capped",
        value: feature.fallback(input, "cost_limit"),
        prompt,
        promptHash,
        attempts: attempt,
        spentMicros: spent,
        judgeSpendMicros: 0,
        elapsedMs: performance.now() - started,
        warnings,
      };
    }
    spent += result.costMicros;
    if (
      result.stopReason === "rate_limited" ||
      result.stopReason === "timeout" ||
      result.stopReason === "unavailable"
    ) {
      lastReason = result.stopReason;
      continue;
    }
    let parsed: { ok: true; value: unknown } | { ok: false; reason: string };
    try {
      parsed = feature.parse(result.text);
    } catch (error) {
      return errorReport(prompt, attempt, spent, started, warnings, error);
    }
    if (!parsed.ok) {
      lastReason = parsed.reason;
      continue;
    }
    const schema = feature.outputSchema.safeParse(parsed.value);
    if (!schema.success) {
      lastReason = "schema_mismatch";
      continue;
    }
    return {
      status: "pass",
      value: schema.data,
      prompt,
      promptHash,
      attempts: attempt,
      spentMicros: spent,
      judgeSpendMicros: 0,
      elapsedMs: performance.now() - started,
      warnings,
    };
  }
  return {
    status: "fallback",
    value: feature.fallback(input, lastReason),
    prompt,
    promptHash,
    attempts: maxAttempts,
    spentMicros: spent,
    judgeSpendMicros: 0,
    elapsedMs: performance.now() - started,
    warnings,
  };
}

function errorReport(
  prompt: string,
  attempts: number,
  spentMicros: number,
  started: number,
  warnings: readonly string[],
  error: unknown,
): ShellReport {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "shell_error",
    value: null,
    prompt,
    promptHash: sha256Hex(prompt),
    attempts,
    spentMicros,
    judgeSpendMicros: 0,
    elapsedMs: performance.now() - started,
    warnings,
    error: message,
  };
}
