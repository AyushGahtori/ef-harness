import type {
  AdapterCallOptions,
  ModelProfile,
  ModelProtocolAdapter,
  ModelRoute,
} from "@ef-harness/worker-loop";
import { DEFAULT_SHARD_CONCURRENCY, MAX_SHARD_TOKENS, isCrossCuttingRuleId } from "./constants.js";
import { gateAuditorFindings } from "./evidence-gate.js";
import { ShardContextError } from "./errors.js";
import { isBlockedAuditor, parseFinalProjectAuditorV1 } from "./schema.js";
import { estimateTokens, makeFinding } from "./text.js";
import type { BudgetLedgerPort } from "./budget.js";
import type {
  CanonicalCatalog,
  FinalProjectAuditorModel,
  PlannedShard,
  RepoFile,
  RequirementRef,
  ShardInputs,
  ShardKind,
  ShardRun,
  ShardSlice,
} from "./types.js";

export interface ShardAuditRequest {
  readonly projectId: string;
  readonly inputs: ShardInputs;
  readonly catalog: CanonicalCatalog;
  readonly files: readonly RepoFile[];
  readonly receiptSummary: string;
  readonly model: FinalProjectAuditorModel;
  readonly ledger: BudgetLedgerPort;
  readonly auditScopeId: string;
  readonly costPerShardUnits: bigint;
  readonly fixCostUnits: bigint;
  readonly concurrency?: number;
  readonly forceShardIds?: readonly string[];
  readonly onShard?: (run: ShardRun) => void | Promise<void>;
}

/** Adapts `@ef-harness/worker-loop` `ModelProtocolAdapter` to `FinalProjectAuditorModel`. */
export function adaptFinalProjectAuditorModel(
  adapter: ModelProtocolAdapter,
  config: {
    readonly model: string;
    readonly profile: ModelProfile;
    readonly route: ModelRoute;
    readonly callOptions: AdapterCallOptions;
    readonly systemPrompt?: string;
    readonly reservedOutputTokens?: number;
  },
): FinalProjectAuditorModel {
  let seq = 0;
  return {
    async audit(input) {
      seq += 1;
      const stream = adapter.stream(
        {
          model: config.model,
          profile: config.profile,
          route: config.route,
          prefix: {
            zone1: config.systemPrompt ?? "You are final-project-auditor@1 reviewing one bounded shard.",
            zone2: "Return strict FinalProjectAuditorV1 JSON.",
          },
          messages: [{ role: "user", text: input.prompt }],
          tools: [],
          replayItems: [],
          reservedOutputTokens: config.reservedOutputTokens ?? 1024,
          clientRequestId: `final-audit-${input.shardId}-${seq}`,
          idempotencyKey: `final-audit-${input.shardId}-${seq}`,
        },
        config.callOptions,
      );
      let structured: unknown;
      let text = "";
      for await (const event of stream) {
        if (event.type === "structured_output") {
          structured = event.parsed;
        } else if (event.type === "text_delta") {
          text += event.text;
        } else if (event.type === "error") {
          throw new Error(event.error.message);
        }
      }
      if (structured !== undefined) return structured;
      return JSON.parse(text) as unknown;
    },
  };
}

function mergeSlices(kind: ShardKind, slices: readonly ShardSlice[]): PlannedShard[] {
  const grouped = new Map<string, ShardSlice[]>();
  for (const slice of slices) {
    if (kind === "rule") {
      if (slice.active === false) continue;
      if (!isCrossCuttingRuleId(slice.id)) continue;
    }
    const list = grouped.get(slice.id) ?? [];
    list.push(slice);
    grouped.set(slice.id, list);
  }
  const shards: PlannedShard[] = [];
  for (const [subjectId, group] of grouped) {
    const requirements: RequirementRef[] = [];
    const files: RepoFile[] = [];
    const diffs: string[] = [];
    const seenReq = new Set<string>();
    const seenFile = new Set<string>();
    for (const slice of group) {
      for (const requirement of slice.requirements) {
        if (seenReq.has(requirement.id)) continue;
        seenReq.add(requirement.id);
        requirements.push(requirement);
      }
      for (const file of slice.files) {
        if (seenFile.has(file.path)) continue;
        seenFile.add(file.path);
        files.push(file);
      }
      if (slice.diff.trim().length > 0) diffs.push(slice.diff.trim());
    }
    shards.push({
      id: `${kind}:${subjectId}`,
      kind,
      subjectId,
      requirements,
      files,
      diff: diffs.join("\n"),
    });
  }
  shards.sort((left, right) => left.id.localeCompare(right.id));
  return shards;
}

export function planShards(inputs: ShardInputs): PlannedShard[] {
  return [
    ...mergeSlices("feature", inputs.features),
    ...mergeSlices("seam", inputs.seams),
    ...mergeSlices("rule", inputs.rules),
  ];
}

function renderPrompt(shard: PlannedShard, receiptSummary: string): string {
  const requirements = shard.requirements.map((item) => `- ${item.id}: ${item.text}`).join("\n");
  const files = shard.files.map((file) => `FILE ${file.path}\n${file.content}`).join("\n");
  return [
    "READ ONLY final-project-auditor@1",
    `SHARD ${shard.id}`,
    "REQUIREMENTS",
    requirements,
    "DIFF",
    shard.diff,
    "FILES",
    files,
    "LAYER A/B RECEIPTS",
    receiptSummary,
  ].join("\n");
}

export function boundShardPrompt(
  shard: PlannedShard,
  receiptSummary: string,
): { readonly prompt: string; readonly tokenEstimate: number } {
  let files = shard.files.map((file) => ({ path: file.path, content: file.content }));
  let diff = shard.diff;
  const render = (): string =>
    renderPrompt(
      { ...shard, files: files.map((file) => ({ path: file.path, content: file.content })), diff },
      receiptSummary,
    );
  let prompt = render();
  while (estimateTokens(prompt) >= MAX_SHARD_TOKENS && files.some((file) => file.content.length > 0)) {
    let index = 0;
    for (let i = 1; i < files.length; i += 1) {
      const candidate = files[i];
      const current = files[index];
      if (candidate && current && candidate.content.length > current.content.length) index = i;
    }
    const target = files[index];
    if (!target) break;
    const next = files.slice();
    next[index] = {
      path: target.path,
      content: target.content.slice(0, Math.floor(target.content.length / 2)),
    };
    files = next;
    prompt = render();
  }
  while (estimateTokens(prompt) >= MAX_SHARD_TOKENS && diff.length > 0) {
    diff = diff.slice(0, Math.floor(diff.length / 2));
    prompt = render();
  }
  const tokenEstimate = estimateTokens(prompt);
  if (tokenEstimate >= MAX_SHARD_TOKENS) {
    throw new ShardContextError(`shard ${shard.id} still has ${tokenEstimate} tokens`);
  }
  return { prompt, tokenEstimate };
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: unknown;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (failure) return;
      const current = next;
      next += 1;
      if (current >= items.length) return;
      const item = items[current];
      if (item === undefined) return;
      try {
        results[current] = await fn(item);
      } catch (error) {
        failure = error;
        throw error;
      }
    }
  });
  try {
    await Promise.all(workers);
  } catch (error) {
    if (failure) throw failure;
    throw error;
  }
  return results;
}

export class ShardedFinalProjectAuditor {
  plan(inputs: ShardInputs): PlannedShard[] {
    return planShards(inputs);
  }

  promptFor(shard: PlannedShard, receiptSummary: string): { readonly prompt: string; readonly tokenEstimate: number } {
    return boundShardPrompt(shard, receiptSummary);
  }

  async run(request: ShardAuditRequest, shards = this.plan(request.inputs)): Promise<ShardRun[]> {
    const concurrency = request.concurrency ?? DEFAULT_SHARD_CONCURRENCY;
    const selected = request.forceShardIds
      ? shards.filter((shard) => request.forceShardIds?.includes(shard.id))
      : shards;
    return mapPool(selected, concurrency, (shard) => this.auditOne(request, shard));
  }

  private async auditOne(request: ShardAuditRequest, shard: PlannedShard): Promise<ShardRun> {
    const finish = async (run: ShardRun): Promise<ShardRun> => {
      await request.onShard?.(run);
      return run;
    };
    const bounded = boundShardPrompt(shard, request.receiptSummary);
    const reservation = await request.ledger.reserveAcrossScopes({
      scopeId: request.auditScopeId,
      units: request.costPerShardUnits,
      purpose: "final_audit",
    });
    if (!reservation) {
      return finish({
        shard,
        prompt: bounded.prompt,
        tokenEstimate: bounded.tokenEstimate,
        status: "skipped_budget",
        findings: [],
        discarded: 0,
        llmTokens: 0,
      });
    }
    let raw: unknown;
    try {
      raw = await request.model.audit({
        shardId: shard.id,
        prompt: bounded.prompt,
        tokenEstimate: bounded.tokenEstimate,
      });
      await request.ledger.settleReservation(reservation.reservationId);
    } catch (error) {
      await request.ledger.releaseReservation(reservation.reservationId);
      throw error;
    }
    try {
      const parsed = parseFinalProjectAuditorV1(raw);
      if (isBlockedAuditor(parsed)) {
        return finish({
          shard,
          prompt: bounded.prompt,
          tokenEstimate: bounded.tokenEstimate,
          status: "blocked",
          findings: [
            makeFinding({
              code: "llm-blocked",
              shardId: shard.id,
              kind: "blocked",
              severity: "medium",
              detail: `final-project-auditor@1 blocked on ${shard.id}: ${parsed.reason}`,
              fixCostUnits: request.fixCostUnits,
            }),
          ],
          discarded: 0,
          llmTokens: bounded.tokenEstimate,
        });
      }
      const gated = gateAuditorFindings({
        shardId: shard.id,
        output: parsed,
        files: request.files,
        catalog: request.catalog,
        fixCostUnits: request.fixCostUnits,
      });
      return finish({
        shard,
        prompt: bounded.prompt,
        tokenEstimate: bounded.tokenEstimate,
        status: "complete",
        findings: gated.confirmed,
        discarded: gated.discarded,
        llmTokens: bounded.tokenEstimate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid auditor output";
      return finish({
        shard,
        prompt: bounded.prompt,
        tokenEstimate: bounded.tokenEstimate,
        status: "invalid_output",
        findings: [
          makeFinding({
            code: "llm-invalid",
            shardId: shard.id,
            kind: "invalid_output",
            severity: "medium",
            detail: `${shard.id} returned invalid auditor output: ${message}`,
            fixCostUnits: request.fixCostUnits,
          }),
        ],
        discarded: 0,
        llmTokens: bounded.tokenEstimate,
      });
    }
  }
}
