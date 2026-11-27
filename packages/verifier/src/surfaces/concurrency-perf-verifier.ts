import { appUrl, joinUrl, requestJson } from "./http.js";
import { createAsyncBarrier } from "./ports/barrier.js";
import { createOsCpuSampler, hostCpuPercent, percentileNearestRank, type HostCpuSampler } from "./ports/cpu.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { ConcurrencyPerfCheckSchema, type ConcurrencyPerfCheck } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceCheckVerifier, SurfaceVerifierContext } from "./types.js";

export interface ConcurrencyPerfDependencies {
  readonly hostCpu?: HostCpuSampler;
}

interface WriteResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export class ConcurrencyPerfVerifier implements SurfaceCheckVerifier {
  readonly id = "concurrency-perf";
  readonly surface = "concurrency";

  constructor(private readonly dependencies: ConcurrencyPerfDependencies = {}) {}

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(ConcurrencyPerfCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    try {
      const base = appUrl(context.env.vars());
      const dialect = await this.dialect(base, check, context);
      const race = await this.race(base, check, context);
      const perf = await this.performance(base, check, context);
      return [dialect, race, perf];
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    }
  }

  private async dialect(
    base: string,
    check: ConcurrencyPerfCheck,
    context: SurfaceVerifierContext,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:dialect`;
    const response = await requestJson(joinUrl(base, check.dialectProbePath));
    const reported =
      typeof response.body === "object" && response.body !== null
        ? (response.body as { dialect?: unknown }).dialect
        : undefined;
    if (reported !== check.manifestDialect) {
      return implementationFailure(
        checkId,
        context,
        `target dialect ${String(reported)} does not match manifest ${check.manifestDialect}`,
        { manifestDialect: check.manifestDialect, reportedDialect: reported },
      );
    }
    return passing(checkId, context, `concurrency target uses ${check.manifestDialect}`, {
      engineDialect: check.manifestDialect,
    });
  }

  private async race(
    base: string,
    check: ConcurrencyPerfCheck,
    context: SurfaceVerifierContext,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:race`;
    const barrier = createAsyncBarrier(check.barrierParties ?? 2);
    const barrierId = `barrier-${context.attemptId}-${check.checkId}`;
    const writes = await Promise.all(
      check.clients.map(async (client) => {
        await barrier.arrive();
        const response = await requestJson(joinUrl(base, check.path), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [check.barrierHeader ?? "X-Barrier-Id"]: barrierId,
            "x-barrier-parties": String(check.barrierParties ?? 2),
          },
          body: JSON.stringify(client.body),
        });
        const body =
          typeof response.body === "object" && response.body !== null
            ? (response.body as Record<string, unknown>)
            : {};
        return { status: response.status, body } satisfies WriteResponse;
      }),
    );
    const finalResponse = await requestJson(joinUrl(base, check.readPath));
    const finalBody =
      typeof finalResponse.body === "object" && finalResponse.body !== null
        ? (finalResponse.body as Record<string, unknown>)
        : {};
    const problems =
      check.mode === "optimistic_version"
        ? optimisticProblems(writes, finalBody, check.clients.map((client) => client.body))
        : lastWriteProblems(writes, finalBody, check.clients.map((client) => client.body));
    if (problems.length > 0) {
      return implementationFailure(checkId, context, problems.join("; "), {
        mode: check.mode,
        engineDialect: check.manifestDialect,
        statuses: writes.map((write) => write.status),
        final: finalBody,
      });
    }
    return passing(checkId, context, `${check.mode} preserved a complete row under a two-client barrier`, {
      mode: check.mode,
      engineDialect: check.manifestDialect,
      statuses: writes.map((write) => write.status),
    });
  }

  private async performance(
    base: string,
    check: ConcurrencyPerfCheck,
    context: SurfaceVerifierContext,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:perf`;
    const perf = check.performance;
    const sampler = this.dependencies.hostCpu ?? createOsCpuSampler();
    const before = sampler.sample();
    for (let index = 0; index < perf.warmup; index += 1) {
      await requestJson(joinUrl(base, `${perf.path}?seed=${perf.seed}&rows=${perf.datasetRows}`));
    }
    const samples: number[] = [];
    let reportedRows = 0;
    let reportedSeed = 0;
    for (let index = 0; index < perf.iterations; index += 1) {
      const started = performance.now();
      const response = await requestJson(joinUrl(base, `${perf.path}?seed=${perf.seed}&rows=${perf.datasetRows}`));
      samples.push(performance.now() - started);
      if (typeof response.body === "object" && response.body !== null) {
        const body = response.body as { rows?: unknown; seed?: unknown };
        reportedRows = Number(body.rows ?? 0);
        reportedSeed = Number(body.seed ?? 0);
      }
    }
    const after = sampler.sample();
    const hostCpu = hostCpuPercent(before, after);
    const p95 = percentileNearestRank(samples, 95);
    const receipt = {
      datasetRowCount: perf.datasetRows,
      iterationCount: perf.iterations,
      seed: perf.seed,
      p95ThresholdMs: perf.p95ThresholdMs,
      p95Ms: p95,
      hostCpuPercent: hostCpu,
      engineDialect: check.manifestDialect,
      warmup: perf.warmup,
      reportedRows,
      reportedSeed,
    };
    if (reportedRows !== perf.datasetRows || reportedSeed !== perf.seed) {
      return implementationFailure(
        checkId,
        context,
        `performance target did not use the ${perf.datasetRows}-row seed ${perf.seed}`,
        receipt,
      );
    }
    if (hostCpu > perf.maxHostCpuPercent) {
      return environmentFailure(checkId, context, "host CPU noise exceeded tolerance; performance check deferred", {
        ...receipt,
        flag: "environment_noisy",
        deferred: true,
      });
    }
    if (p95 > perf.p95ThresholdMs) {
      return implementationFailure(
        checkId,
        context,
        `p95 ${p95.toFixed(2)}ms exceeded ${perf.p95ThresholdMs}ms`,
        receipt,
      );
    }
    return passing(checkId, context, `p95 ${p95.toFixed(2)}ms is within ${perf.p95ThresholdMs}ms`, receipt);
  }
}

function sameRecord(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false;
  }
  return true;
}

function rowOf(finalBody: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const row = finalBody.row;
  if (typeof row === "object" && row !== null) return row as Record<string, unknown>;
  return finalBody;
}

function optimisticProblems(
  writes: readonly WriteResponse[],
  finalBody: Readonly<Record<string, unknown>>,
  bodies: readonly Record<string, unknown>[],
): string[] {
  const successes = writes.filter((write) => write.status === 200);
  const conflicts = writes.filter((write) => write.status === 409);
  const problems: string[] = [];
  if (successes.length !== 1 || conflicts.length !== 1) {
    problems.push(`expected one 200 and one 409, received ${writes.map((write) => write.status).join(", ")}`);
  }
  const winner = bodies.find((body) => sameRecord(rowOf(finalBody), projected(body)));
  if (!winner) problems.push("final row is not one complete client write");
  return problems;
}

function lastWriteProblems(
  writes: readonly WriteResponse[],
  finalBody: Readonly<Record<string, unknown>>,
  bodies: readonly Record<string, unknown>[],
): string[] {
  const problems: string[] = [];
  if (writes.some((write) => write.status !== 200)) {
    problems.push(`last_write_wins expected two 200s, received ${writes.map((write) => write.status).join(", ")}`);
  }
  const row = rowOf(finalBody);
  const matches = bodies.filter((body) => sameRecord(row, projected(body)));
  if (matches.length !== 1) problems.push("final row mixed fields from both clients or matched neither write");
  return problems;
}

function projected(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.expectedVersion;
  delete copy.barrier;
  return copy;
}
