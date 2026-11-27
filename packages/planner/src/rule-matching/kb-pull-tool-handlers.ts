import { CrossCuttingRuleMatcher } from "./cross-cutting-rule-matcher.js";
import { utf8Bytes } from "./hash.js";
import { isSealedOracle } from "./oracle.js";
import type { FtsSearchHit, FtsSearchRepo } from "./ports/fts-search-repo.js";
import type { LeasedMcpServerPort, McpToolDefinition } from "./ports/leased-mcp-server.js";
import { PullTurnBudget, turnBudgetKey } from "./pull-budget.js";
import {
  recordFromContext,
  type PullAnalyticsDraft,
  type PullReadAnalyticsRecorder,
  type PulledNodeFact,
} from "./pull-read-analytics-recorder.js";
import {
  budgetExceededResponse,
  dataEnvelope,
  invalidParamsResponse,
  notFoundResponse,
} from "./responses.js";
import { boundText, normalizeSearchConcept } from "./text.js";
import type { KbToolName, KnowledgeNode, PullCallContext } from "./types.js";

const MAX_PROSE_CHARS = 2_000;
const MAX_SEARCH_LIMIT = 10;

export interface KbPullHandlerDeps {
  readonly repo: FtsSearchRepo;
  readonly recorder: PullReadAnalyticsRecorder;
  readonly matcher?: CrossCuttingRuleMatcher;
  readonly budget?: PullTurnBudget;
  readonly expectedLeaseEpoch?: number;
}

interface ProducedCall {
  readonly response: unknown;
  readonly analytics: PullAnalyticsDraft;
}

/**
 * Read-only, token-bounded `kb.*` tools.
 * Sealed oracles and unknown ids share one NOT_FOUND body. Hidden nodes never appear in search.
 */
export class KbPullToolHandlers {
  private readonly matcher: CrossCuttingRuleMatcher;
  private readonly budget: PullTurnBudget;

  constructor(private readonly deps: KbPullHandlerDeps) {
    this.matcher = deps.matcher ?? new CrossCuttingRuleMatcher();
    this.budget = deps.budget ?? new PullTurnBudget();
  }

  definitions(): readonly McpToolDefinition[] {
    return [
      {
        name: "kb.search",
        description: "Ranked read-only search over visible knowledge nodes. Limit is at most 10.",
        readOnly: true,
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            types: { type: "array", items: { type: "string" } },
            filters: { type: "object" },
            limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_LIMIT },
          },
        },
      },
      {
        name: "kb.get_node",
        description: "Canonical fields, prose, and outgoing contract links for one visible node.",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: {
            node_id: { type: "string" },
            id: { type: "string" },
          },
        },
      },
      {
        name: "kb.get_contract",
        description: "Schemas, seams, and error codes for one visible contract.",
        readOnly: true,
        inputSchema: {
          type: "object",
          required: ["contract_id"],
          properties: {
            contract_id: { type: "string" },
            id: { type: "string" },
            idAtVersion: { type: "string" },
          },
        },
      },
      {
        name: "kb.list_rules",
        description: "Active cross-cutting rules whose any/all scope matches the given tags.",
        readOnly: true,
        inputSchema: {
          type: "object",
          required: ["tags"],
          properties: { tags: { type: "array", items: { type: "string" } } },
        },
      },
      {
        name: "kb.list_rules_for_tags",
        description: "Active cross-cutting rules whose any/all scope matches the given tags.",
        readOnly: true,
        inputSchema: {
          type: "object",
          required: ["tags"],
          properties: { tags: { type: "array", items: { type: "string" } } },
        },
      },
    ];
  }

  register(server: LeasedMcpServerPort): void {
    server.register(this.definitions(), (name, args, ctx) => this.call(name, args, ctx));
  }

  call(name: KbToolName, args: Readonly<Record<string, unknown>>, ctx: PullCallContext): unknown {
    if (this.fenced(ctx)) {
      return {
        ok: false,
        code: "LEASE_FENCED",
        message: "MCP lease epoch is not current",
        trust: "kb",
        label: "data",
        source: name,
      };
    }
    const turnKey = turnBudgetKey(ctx.attemptId, ctx.turnId);
    if (!this.budget.hasCallRoom(turnKey) || !this.budget.hasByteRoom(turnKey)) {
      this.deps.recorder.record(this.refusal(ctx, name));
      return budgetExceededResponse(name);
    }
    const started = this.deps.recorder.now();
    const produced = this.produce(name, args, ctx, started);
    const size = utf8Bytes(produced.response);
    if (!this.budget.consume(turnKey, size)) {
      this.deps.recorder.record(this.refusal(ctx, name, this.deps.recorder.now() - started));
      return budgetExceededResponse(name);
    }
    this.deps.recorder.record(produced.analytics);
    return produced.response;
  }

  private fenced(ctx: PullCallContext): boolean {
    const expected = this.deps.expectedLeaseEpoch;
    if (expected === undefined || ctx.leaseEpoch === undefined) return false;
    return ctx.leaseEpoch !== expected;
  }

  private produce(
    name: KbToolName,
    args: Readonly<Record<string, unknown>>,
    ctx: PullCallContext,
    started: number,
  ): ProducedCall {
    if (name === "kb.search") return this.search(args, ctx, started);
    if (name === "kb.get_node") return this.getNode(args, ctx, started);
    if (name === "kb.get_contract") return this.getContract(args, ctx, started);
    return this.listRules(name, args, ctx, started);
  }

  private search(
    args: Readonly<Record<string, unknown>>,
    ctx: PullCallContext,
    started: number,
  ): ProducedCall {
    const tool: KbToolName = "kb.search";
    const query = readString(args, "query");
    if (query === null || query.trim() === "") {
      return this.invalid(ctx, tool, "query must be a non-empty string", started);
    }
    const explicitTypes = readStringArray(args, "types");
    if (explicitTypes === null) {
      return this.invalid(ctx, tool, "types must be an array of strings", started);
    }
    const filterTypes = typesFromFilters(args.filters);
    if (filterTypes === null) {
      return this.invalid(ctx, tool, "filters.kind must be a string", started);
    }
    const types = explicitTypes.length > 0 ? explicitTypes : filterTypes;
    const limit = clampLimit(args.limit);
    if (limit === null) {
      return this.invalid(ctx, tool, "limit must be a positive number", started);
    }
    const page = this.deps.repo.search({ query, types, limit });
    const hits = page.hits.map((hit) => ({
      nodeId: hit.nodeId,
      kind: hit.kind,
      title: hit.title,
      snippet: hit.snippet,
      score: hit.score,
      version: hit.version,
    }));
    const response = { ...dataEnvelope(tool), limit, hits };
    const pulled = page.hits.map(factFromHit);
    const securityAnomaly = hits.length === 0 && page.hiddenMatchCount > 0;
    const latencyMs = this.deps.recorder.now() - started;
    return {
      response,
      analytics: {
        record: recordFromContext(ctx, {
          toolName: tool,
          queriedNodeId: pulled[0]?.nodeId ?? null,
          pulledNodeIds: pulled.map((node) => node.nodeId),
          pulledNodes: pulled,
          wasInCouldIndex: pulled[0]?.couldIndex ?? false,
          wasNegativeMiss: hits.length === 0,
          latencyMs,
          securityAnomaly,
          budgetExceeded: false,
          nodeTokenCost: pulled[0]?.tokenCost ?? 0,
          currentMustTokens: ctx.currentMustTokens ?? 0,
          currentBand: pulled[0]?.band ?? null,
        }),
        searchRead: {
          attempt: ctx.attemptId,
          query,
          types,
          limit,
          resultIds: hits.map((hit) => hit.nodeId),
          rev: page.revision,
          securityProbe: securityAnomaly,
          concept: normalizeSearchConcept(query),
        },
      },
    };
  }

  private getNode(
    args: Readonly<Record<string, unknown>>,
    ctx: PullCallContext,
    started: number,
  ): ProducedCall {
    const tool: KbToolName = "kb.get_node";
    const nodeId = readString(args, "node_id") ?? readString(args, "id");
    if (nodeId === null || nodeId.trim() === "") {
      return this.invalid(ctx, tool, "node_id must be a non-empty string", started);
    }
    const node = this.deps.repo.getNode(nodeId);
    if (!node || node.status !== "active" || isSealedOracle(node)) {
      return this.miss(ctx, tool, nodeId, started, Boolean(node && isSealedOracle(node)));
    }
    const prose = boundText(node.prose, MAX_PROSE_CHARS);
    const links = node.outgoingContractLinks.filter((link) => {
      const target = this.deps.repo.getNode(link.contractId);
      return !target || !isSealedOracle(target);
    });
    const response = {
      ...dataEnvelope(tool),
      node: {
        id: node.id,
        kind: node.kind,
        title: node.title,
        prose: prose.text,
        proseTruncated: prose.truncated,
        canonical: node.canonical,
        outgoingContractLinks: links.map((link) => ({
          contractId: link.contractId,
          relation: link.relation,
        })),
        version: node.version,
      },
    };
    return { response, analytics: this.hitAnalytics(ctx, tool, node, started) };
  }

  private getContract(
    args: Readonly<Record<string, unknown>>,
    ctx: PullCallContext,
    started: number,
  ): ProducedCall {
    const tool: KbToolName = "kb.get_contract";
    const contractRaw = readString(args, "contract_id") ?? readString(args, "id") ?? readString(args, "idAtVersion");
    const contractId = contractRaw === null ? null : contractIdentity(contractRaw);
    if (contractId === null || contractId.trim() === "") {
      return this.invalid(ctx, tool, "contract_id must be a non-empty string", started);
    }
    const node = this.deps.repo.getNode(contractId);
    if (!node || node.status !== "active" || isSealedOracle(node)) {
      return this.miss(ctx, tool, contractId, started, Boolean(node && isSealedOracle(node)));
    }
    if (node.kind !== "contract") {
      const response = {
        ok: false,
        code: "NOT_A_CONTRACT",
        message: "Not a contract",
        trust: "kb" as const,
        label: "data" as const,
        source: tool,
      };
      const latencyMs = this.deps.recorder.now() - started;
      return {
        response,
        analytics: {
          record: recordFromContext(ctx, {
            toolName: tool,
            queriedNodeId: contractId,
            pulledNodeIds: [],
            pulledNodes: [],
            wasInCouldIndex: false,
            wasNegativeMiss: false,
            latencyMs,
            securityAnomaly: false,
            budgetExceeded: false,
            nodeTokenCost: 0,
            currentMustTokens: ctx.currentMustTokens ?? 0,
            currentBand: null,
          }),
        },
      };
    }
    const response = {
      ...dataEnvelope(tool),
      contract: {
        id: node.id,
        schemas: node.schemas,
        seams: node.seams,
        errorCodes: [...node.errorCodes],
        version: node.version,
      },
    };
    return { response, analytics: this.hitAnalytics(ctx, tool, node, started) };
  }

  private listRules(
    tool: KbToolName,
    args: Readonly<Record<string, unknown>>,
    ctx: PullCallContext,
    started: number,
  ): ProducedCall {
    const tags = readStringArray(args, "tags");
    if (tags === null) {
      return this.invalid(ctx, tool, "tags must be an array of strings", started);
    }
    const report = this.matcher.matchTags(tags);
    const rules = report.matches.map((match) => ({
      id: match.ruleId,
      title: match.title,
      matchedVia: match.matchedVia,
      appliesAs: match.appliesAs,
      checkIds: [...match.checkIds],
      matchedTags: [...match.matchedTags],
    }));
    const response = { ...dataEnvelope(tool), rules };
    const latencyMs = this.deps.recorder.now() - started;
    return {
      response,
      analytics: {
        record: recordFromContext(ctx, {
          toolName: tool,
          queriedNodeId: null,
          pulledNodeIds: rules.map((rule) => rule.id),
          pulledNodes: rules.map((rule) => ({
            nodeId: rule.id,
            band: "COULD" as const,
            tokenCost: 0,
            couldIndex: true,
          })),
          wasInCouldIndex: false,
          wasNegativeMiss: rules.length === 0,
          latencyMs,
          securityAnomaly: false,
          budgetExceeded: false,
          nodeTokenCost: 0,
          currentMustTokens: ctx.currentMustTokens ?? 0,
          currentBand: null,
        }),
      },
    };
  }

  private hitAnalytics(
    ctx: PullCallContext,
    tool: KbToolName,
    node: KnowledgeNode,
    started: number,
  ): PullAnalyticsDraft {
    const fact = factFromNode(node);
    return {
      record: recordFromContext(ctx, {
        toolName: tool,
        queriedNodeId: node.id,
        pulledNodeIds: [node.id],
        pulledNodes: [fact],
        wasInCouldIndex: fact.couldIndex,
        wasNegativeMiss: false,
        latencyMs: this.deps.recorder.now() - started,
        securityAnomaly: false,
        budgetExceeded: false,
        nodeTokenCost: fact.tokenCost,
        currentMustTokens: ctx.currentMustTokens ?? 0,
        currentBand: fact.band,
      }),
    };
  }

  private miss(
    ctx: PullCallContext,
    tool: KbToolName,
    nodeId: string,
    started: number,
    securityAnomaly: boolean,
  ): ProducedCall {
    return {
      response: notFoundResponse(tool),
      analytics: {
        record: recordFromContext(ctx, {
          toolName: tool,
          queriedNodeId: nodeId,
          pulledNodeIds: [],
          pulledNodes: [],
          wasInCouldIndex: false,
          wasNegativeMiss: true,
          latencyMs: this.deps.recorder.now() - started,
          securityAnomaly,
          budgetExceeded: false,
          nodeTokenCost: 0,
          currentMustTokens: ctx.currentMustTokens ?? 0,
          currentBand: null,
        }),
      },
    };
  }

  private invalid(
    ctx: PullCallContext,
    tool: KbToolName,
    message: string,
    started: number,
  ): ProducedCall {
    return {
      response: invalidParamsResponse(tool, message),
      analytics: {
        record: recordFromContext(ctx, {
          toolName: tool,
          queriedNodeId: null,
          pulledNodeIds: [],
          pulledNodes: [],
          wasInCouldIndex: false,
          wasNegativeMiss: false,
          latencyMs: this.deps.recorder.now() - started,
          securityAnomaly: false,
          budgetExceeded: false,
          nodeTokenCost: 0,
          currentMustTokens: ctx.currentMustTokens ?? 0,
          currentBand: null,
        }),
      },
    };
  }

  private refusal(ctx: PullCallContext, tool: KbToolName, latencyMs = 0): PullAnalyticsDraft {
    return {
      record: recordFromContext(ctx, {
        toolName: tool,
        queriedNodeId: null,
        pulledNodeIds: [],
        pulledNodes: [],
        wasInCouldIndex: false,
        wasNegativeMiss: false,
        latencyMs,
        securityAnomaly: false,
        budgetExceeded: true,
        nodeTokenCost: 0,
        currentMustTokens: ctx.currentMustTokens ?? 0,
        currentBand: null,
      }),
    };
  }
}

function factFromHit(hit: FtsSearchHit): PulledNodeFact {
  return {
    nodeId: hit.nodeId,
    band: hit.band,
    tokenCost: hit.tokenCost,
    couldIndex: hit.couldIndex,
  };
}

function factFromNode(node: KnowledgeNode): PulledNodeFact {
  return {
    nodeId: node.id,
    band: node.band,
    tokenCost: node.tokenCost,
    couldIndex: node.couldIndex || node.band === "COULD",
  };
}

function readString(args: Readonly<Record<string, unknown>>, key: string): string | null {
  if (!(key in args)) return null;
  const value = args[key];
  return typeof value === "string" ? value : null;
}

function readStringArray(
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | null {
  if (!(key in args) || args[key] === undefined) return [];
  const value = args[key];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

function typesFromFilters(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (!("kind" in value)) return [];
  const kind = value.kind;
  if (kind === undefined) return [];
  return typeof kind === "string" ? [kind] : null;
}

function contractIdentity(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;
  const versionText = value.slice(at + 1);
  if (!/^\d+$/.test(versionText)) return value;
  return value.slice(0, at);
}

function clampLimit(value: unknown): number | null {
  if (value === undefined) return MAX_SEARCH_LIMIT;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  if (floored < 1) return null;
  return Math.min(floored, MAX_SEARCH_LIMIT);
}
