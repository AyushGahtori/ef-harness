import { checkCitation } from "./citations.js";
import { consultModel } from "./model-select.js";
import { buildAskOwnerPrompt } from "./prompts.js";
import { isBlockedExit, parseAskOwnerResponderV1 } from "./schemas.js";
import type { SpecialistStateDb } from "./state-db.js";
import type {
  AskOwnerSchemaPayload,
  ClickableCitation,
  DecisionCard,
  DecisionOption,
  GraphNode,
  ModelRosterEntry,
  OwnerAnswer,
  OwnerQuestionRequest,
  SchemaChange,
  SpecialistModel,
  TableFact,
  TaskFact,
  WorkerEscalationRequest,
} from "./types.js";

const NOT_STARTED = new Set(["DRAFTED", "READY", "CANCELLED", "SUPERSEDED"]);

const STATE_PLAIN: Readonly<Record<string, string>> = {
  DRAFTED: "not started",
  READY: "queued and not started",
  LEASED: "assigned to a worker",
  CODING: "being written",
  STATIC_AUDIT: "in the static check",
  CLEAN_VERIFY: "in verification",
  ACCEPTED: "accepted",
  MERGED_TO_FEATURE: "merged",
  WAITING_INPUT: "waiting for a decision",
  PARKED: "parked",
  ESCALATED: "escalated to you",
  EXHAUSTED: "stopped after repeated failures",
  HUMAN_OWNED: "waiting for you to edit it",
  SUPERSEDED: "replaced",
  CANCELLED: "cancelled",
};

const HOLD_PLAIN: Readonly<Record<string, string>> = {
  user_pause: "You paused it",
  requirement_change: "A requirement changed",
  budget: "The budget is holding it",
  ccr: "A contract change is open",
  governor: "A safety hold is open",
};

const STOP = new Set([
  "a", "an", "the", "did", "do", "does", "we", "you", "is", "are", "was", "were", "yet",
  "add", "added", "have", "has", "how", "what", "which", "why", "when", "where", "who",
  "task", "tasks", "tests", "test", "pass", "passed", "fail", "failed", "stores", "store",
  "stored", "database", "table", "tables", "for", "this", "that", "these", "those", "with",
  "from", "into", "your", "waiting", "about", "tell", "show", "explain", "status",
  "blocked", "happens", "happen", "work", "works", "configured", "configure", "should",
  "exist", "exists", "there", "feature", "check", "checks", "receipt", "receipts", "under",
]);

const ENTITY_ID_PATTERN = /\b(?:[A-Z]{1,6}|rcpt)-[A-Za-z0-9._-]+\b/g;

export class AskOwnerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskOwnerInputError";
  }
}

export interface AskOwnerResponderEngineOptions {
  readonly db: SpecialistStateDb;
  readonly model: SpecialistModel | null;
  readonly roster: readonly ModelRosterEntry[];
  readonly workerFamily: string;
}

interface GroundedText {
  readonly text: string;
  readonly nodeIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly files: readonly string[];
  readonly factSheet: string;
}

interface ModelReply {
  readonly invoked: boolean;
  readonly schema: AskOwnerSchemaPayload | null;
}

function contentTokens(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP.has(token));
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function tokenInHaystack(hay: string, token: string): boolean {
  const stem = stemToken(token);
  return hay.includes(token) || (stem !== token && hay.includes(stem));
}

function haystack(node: GraphNode): string {
  return `${node.id} ${node.title} ${node.text} ${JSON.stringify(node.fields)}`.toLowerCase();
}

function waveOf(node: GraphNode): number | null {
  const wave = node.fields.wave;
  return typeof wave === "number" && Number.isInteger(wave) ? wave : null;
}

function fileOf(node: GraphNode): string | null {
  return typeof node.fields.file === "string" && node.fields.file.length > 0 ? node.fields.file : null;
}

function three(first: string, second: string, third: string): readonly [string, string, string] {
  return [first, second, third];
}

function oneRecommendation(options: readonly DecisionOption[]): string {
  const chosen = options.find((option) => option.recommended);
  if (!chosen || options.filter((option) => option.recommended).length !== 1) {
    throw new AskOwnerInputError("a decision card needs exactly one recommendation");
  }
  if (options.length < 2 || options.length > 3) {
    throw new AskOwnerInputError("a decision card needs two or three options");
  }
  return chosen.id;
}

function requireSchema(payload: AskOwnerSchemaPayload): AskOwnerSchemaPayload {
  const parsed = parseAskOwnerResponderV1(payload);
  if (!parsed.ok || isBlockedExit(parsed.value)) {
    throw new AskOwnerInputError(parsed.ok ? "schema resolved to a blocked exit" : parsed.reason);
  }
  return parsed.value;
}

export class AskOwnerResponderEngine {
  private readonly db: SpecialistStateDb;
  private readonly model: SpecialistModel | null;
  private readonly roster: readonly ModelRosterEntry[];
  private readonly workerFamily: string;

  constructor(options: AskOwnerResponderEngineOptions) {
    this.db = options.db;
    this.model = options.model;
    this.roster = options.roster;
    this.workerFamily = options.workerFamily;
  }

  async answerQuestion(request: string | OwnerQuestionRequest): Promise<OwnerAnswer> {
    const question = (typeof request === "string" ? request : request.question).trim();
    const grounded = this.lookup(question);
    if (!grounded) return this.unknown();
    const reply = await this.askModel(question, grounded.factSheet);
    const llmCalls = reply.invoked ? 1 : 0;
    const text =
      reply.schema &&
      reply.schema.kind === "answer" &&
      reply.schema.changes.length === 0 &&
      this.isGroundedModelReply(reply.schema.text, grounded)
        ? reply.schema.text.trim()
        : grounded.text;
    return this.finish("answer", text, [], grounded, llmCalls);
  }

  async formatWorkerEscalation(request: WorkerEscalationRequest): Promise<OwnerAnswer> {
    if (request.recordedDecision && this.decisionMatches(request.question, request.recordedDecision.quote)) {
      const baseText = `This is already decided: ${request.recordedDecision.quote}`;
      const changes: SchemaChange[] = [{ target_id: request.taskId, text: request.recordedDecision.quote }];
      const reply = await this.askModel(request.question, baseText);
      const llmCalls = reply.invoked ? 1 : 0;
      const text =
        reply.schema &&
        reply.schema.kind === "brief_fix" &&
        reply.schema.text.includes(request.recordedDecision.quote)
          ? reply.schema.text.trim()
          : baseText;
      return this.finish(
        "brief_fix",
        text,
        changes,
        {
          text,
          nodeIds: [request.recordedDecision.id, request.taskId],
          receiptIds: [],
          files: [],
          factSheet: baseText,
        },
        llmCalls,
      );
    }
    const card =
      request.requirementQuote && request.sealedAssertion
        ? this.disputeCard(request.requirementQuote, request.sealedAssertion)
        : this.ambiguityCard(request.question);
    const text = card.lines.join("\n");
    const reply = await this.askModel(request.question, `${text}\n${request.logs}\n${request.diffSummary}`);
    return this.finish(
      "escalate",
      text,
      [],
      {
        text,
        nodeIds: [request.requirementId, request.checkId, request.taskId].filter((id): id is string => Boolean(id)),
        receiptIds: [],
        files: [],
        factSheet: text,
        card,
      },
      reply.invoked ? 1 : 0,
    );
  }

  async resolveDisputeChoice(request: WorkerEscalationRequest, optionId: string): Promise<OwnerAnswer> {
    const quote = request.requirementQuote ?? "";
    const assertion = request.sealedAssertion ?? "";
    const card = this.disputeCard(quote, assertion);
    if (optionId === "follow-requirement") {
      const target = request.checkId ?? request.requirementId ?? request.taskId;
      const text = `Use the requirement and update the sealed check. Requirement: ${quote}`;
      return this.finish(
        "dispute_upheld",
        text,
        [{ target_id: target, text: quote }],
        {
          text,
          nodeIds: [request.requirementId, request.checkId].filter((id): id is string => Boolean(id)),
          receiptIds: [],
          files: [],
          factSheet: text,
          card,
        },
        0,
      );
    }
    if (optionId === "keep-check") {
      const text = `Keep the sealed check as written. Sealed check: ${assertion}`;
      return this.finish(
        "dispute_rejected",
        text,
        [],
        {
          text,
          nodeIds: [request.checkId, request.requirementId].filter((id): id is string => Boolean(id)),
          receiptIds: [],
          files: [],
          factSheet: text,
          card,
        },
        0,
      );
    }
    const text = card.lines.join("\n");
    return this.finish(
      "escalate",
      text,
      [],
      {
        text,
        nodeIds: [request.taskId],
        receiptIds: [],
        files: [],
        factSheet: text,
        card,
      },
      0,
    );
  }

  private lookup(question: string): (GroundedText & { card?: DecisionCard }) | null {
    const waiting = /why is task\s+([A-Za-z0-9._-]+)/i.exec(question);
    if (waiting?.[1]) return this.explainWaiting(waiting[1]);
    const table = /which database table stores\s+([a-z0-9 _-]+)/i.exec(question);
    if (table?.[1]) return this.explainTable(table[1].trim());
    if (/auth tests/i.test(question)) return this.explainReceipts("auth", "Auth tests");
    if (/stripe/i.test(question) && /webhook/i.test(question)) return this.explainFeature(["stripe", "webhook"]);

    const entityHit = this.explainMentionedEntity(question);
    if (entityHit) return entityHit;

    const words = contentTokens(question);

    if (/\b(table|tables|schema|stored|stores|store|persist|persisted|sql)\b/i.test(question)) {
      const tableHit = this.explainTablesByTokens(words);
      if (tableHit) return tableHit;
    }

    if (/\b(test|tests|check|checks|receipt|receipts|pass|passed|fail|failed|coverage)\b/i.test(question)) {
      const receiptHit = this.explainReceiptsByTokens(question, words);
      if (receiptHit) return receiptHit;
    }

    if (/did we add|have we added/i.test(question) && words.length > 0) {
      const feature = this.explainFeature(words);
      if (feature) return feature;
    }

    const featureHit = this.explainFeature(words);
    if (featureHit) return featureHit;

    return this.explainSearch(words);
  }

  private explainMentionedEntity(question: string): GroundedText | null {
    const candidates = question.match(ENTITY_ID_PATTERN) ?? [];
    for (const rawId of candidates) {
      const id = rawId.replace(/[?.!,;:]+$/, "");
      const receipt = this.db.allReceipts().find((item) => item.receiptId === id || item.checkId === id);
      if (receipt && receipt.checkId === id) {
        return this.explainReceipts(receipt.checkId, receipt.title || receipt.checkId);
      }
      if (receipt && receipt.receiptId === id) {
        const text = `Receipt ${receipt.receiptId} for ${receipt.checkId} (${receipt.title || receipt.checkId}) recorded status ${receipt.status}.`;
        return {
          text,
          nodeIds: [receipt.checkId],
          receiptIds: [receipt.receiptId],
          files: [],
          factSheet: text,
        };
      }
      const task = this.findTask(id);
      const node = this.db.getNode(id);
      if (task || node?.kind === "task") {
        return this.explainWaiting(id);
      }
      if (node?.kind === "feature") {
        return this.explainFeatureNode(node);
      }
      if (node) {
        return this.explainNode(node);
      }
    }
    return null;
  }

  private explainNode(node: GraphNode): GroundedText {
    const tables = this.db.allTables().filter((item) => item.ownerNodeId === node.id);
    const parts = [`Recorded in ${node.id}${node.title ? ` (${node.title})` : ""}: ${node.text || node.kind}`];
    if (tables.length > 0) {
      parts.push(`Related tables: ${tables.map((t) => t.table).join(", ")}.`);
    }
    const text = parts.join(" ");
    return {
      text,
      nodeIds: [node.id],
      receiptIds: [],
      files: fileOf(node) ? [fileOf(node) as string] : [],
      factSheet: `${text} ${JSON.stringify(node.fields)}`,
    };
  }

  private explainWaiting(taskId: string): GroundedText | null {
    const node = this.db.getNode(taskId);
    const featureId = typeof node?.fields.feature === "string" ? node.fields.feature : "";
    const tasks = this.db.tasksForFeature(featureId);
    const runtime = tasks.find((task) => task.taskId === taskId) ?? this.findTask(taskId);
    if (!node && !runtime) return null;
    const state = runtime?.state ?? "unknown";
    const plain = STATE_PLAIN[state] ?? `in recorded state ${state}`;
    const holds = this.db.holdsFor(taskId);
    const deps = this.db.dependencyIds(taskId);
    const sentences = [`Task ${taskId} is ${plain}.`];
    for (const hold of holds) {
      sentences.push(`${HOLD_PLAIN[hold.reason] ?? `A hold is recorded (${hold.reason})`}.`);
    }
    const depNodes: string[] = [];
    for (const depId of deps) {
      const depTask = this.findTask(depId);
      const depPlain = depTask ? (STATE_PLAIN[depTask.state] ?? depTask.state) : "not recorded";
      sentences.push(`It depends on ${depId}, which is ${depPlain}.`);
      depNodes.push(depId);
    }
    const text = sentences.join(" ");
    return {
      text,
      nodeIds: [taskId, ...depNodes],
      receiptIds: [],
      files: node && fileOf(node) ? [fileOf(node) as string] : [],
      factSheet: text,
    };
  }

  private explainTable(topic: string): GroundedText | null {
    const tables = this.db.tablesAbout(topic);
    const first = tables[0];
    if (!first) return null;
    const text = `The ${first.table} table stores ${topic}.`;
    return this.buildTableGrounded(first, text);
  }

  private explainTablesByTokens(words: readonly string[]): GroundedText | null {
    const all = this.db.allTables();
    if (all.length === 0) return null;
    if (words.length === 0) {
      const names = all.map((t) => t.table).join(", ");
      const files = all
        .map((t) => this.db.getNode(t.ownerNodeId))
        .map((node) => (node ? fileOf(node) : null))
        .filter((f): f is string => f !== null);
      const text = `Recorded database tables: ${names}.`;
      return {
        text,
        nodeIds: all.map((t) => t.ownerNodeId),
        receiptIds: [],
        files,
        factSheet: `${text} ${all.map((t) => `${t.table}: ${t.title} ${t.text}`).join(" | ")}`,
      };
    }
    const scored = all
      .map((fact) => {
        const hay = `${fact.table} ${fact.title} ${fact.text}`.toLowerCase();
        const hits = words.filter((word) => tokenInHaystack(hay, word)).length;
        return { fact, hits };
      })
      .filter((item) => item.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    const top = scored[0];
    if (!top) return null;
    const minRequired = words.length === 1 ? 1 : Math.min(words.length, Math.ceil(words.length / 2));
    if (top.hits < minRequired) return null;
    const detail = top.fact.text || top.fact.title || words.join(" ");
    const text = `The ${top.fact.table} table stores ${detail}.`;
    return this.buildTableGrounded(top.fact, text);
  }

  private buildTableGrounded(fact: TableFact, text: string): GroundedText {
    const node = this.db.getNode(fact.ownerNodeId);
    return {
      text,
      nodeIds: [fact.ownerNodeId],
      receiptIds: [],
      files: node && fileOf(node) ? [fileOf(node) as string] : [],
      factSheet: `${text} ${fact.title} ${fact.text}`,
    };
  }

  private explainReceipts(topic: string, label: string): GroundedText | null {
    const receipts = this.db.receiptsAbout(topic);
    if (receipts.length === 0) return null;
    const failed = receipts.filter((receipt) => receipt.status !== "pass");
    const text =
      failed.length === 0
        ? `${label} passed (receipt ${receipts.map((receipt) => receipt.receiptId).join(", ")}).`
        : `${label} did not all pass. ${failed.map((receipt) => `${receipt.checkId} is ${receipt.status} (receipt ${receipt.receiptId})`).join(" ")}`;
    return {
      text,
      nodeIds: receipts.map((receipt) => receipt.checkId),
      receiptIds: receipts.map((receipt) => receipt.receiptId),
      files: [],
      factSheet: `${text} ${receipts.map((receipt) => receipt.title).join(" ")}`,
    };
  }

  private explainReceiptsByTokens(question: string, words: readonly string[]): GroundedText | null {
    const all = this.db.allReceipts();
    if (all.length === 0) return null;
    const matched =
      words.length === 0
        ? all
        : all.filter((receipt) => {
            const node = this.db.getNode(receipt.checkId);
            const hay = `${receipt.receiptId} ${receipt.checkId} ${receipt.title} ${node?.text ?? ""}`.toLowerCase();
            return words.some((word) => tokenInHaystack(hay, word));
          });
    if (matched.length === 0) return null;
    if (words.length >= 2) {
      const maxOverlap = Math.max(
        ...matched.map((receipt) => {
          const node = this.db.getNode(receipt.checkId);
          const hay = `${receipt.receiptId} ${receipt.checkId} ${receipt.title} ${node?.text ?? ""}`.toLowerCase();
          return words.filter((word) => tokenInHaystack(hay, word)).length;
        }),
      );
      if (maxOverlap === 0) return null;
    }
    const failing = matched.filter((receipt) => receipt.status !== "pass");
    const askingFailures = /\bfail(?:ed|ing|s)?\b/i.test(question);
    const label = matched.map((r) => r.title || r.checkId).join(", ");
    const text =
      failing.length === 0
        ? askingFailures
          ? `No matching checks failed (${label} passed, receipt ${matched.map((r) => r.receiptId).join(", ")}).`
          : `${label} passed (receipt ${matched.map((r) => r.receiptId).join(", ")}).`
        : `${label} did not all pass. ${failing.map((r) => `${r.checkId} is ${r.status} (receipt ${r.receiptId})`).join(" ")}`;
    return {
      text,
      nodeIds: matched.map((r) => r.checkId),
      receiptIds: matched.map((r) => r.receiptId),
      files: [],
      factSheet: `${text} ${matched.map((r) => `${r.checkId} ${r.title} ${r.status}`).join(" ")}`,
    };
  }

  private explainFeature(words: readonly string[]): GroundedText | null {
    if (words.length === 0) return null;
    const feature = this.db.nodesOfKind("feature").find((node) => {
      const hay = haystack(node);
      return words.every((word) => tokenInHaystack(hay, word));
    });
    if (!feature) return null;
    return this.explainFeatureNode(feature);
  }

  private explainFeatureNode(feature: GraphNode): GroundedText {
    const tasks = this.db.tasksForFeature(feature.id);
    const started = tasks.filter((task) => !NOT_STARTED.has(task.state)).length;
    const total = tasks.length;
    const wave = waveOf(feature);
    const text =
      wave === null
        ? `Feature ${feature.id} is recorded (${String(started)}/${String(total)} tasks started).`
        : `Planned for Wave ${String(wave)} (Feature ${feature.id}, ${String(started)}/${String(total)} tasks started yet)`;
    return {
      text,
      nodeIds: [feature.id, ...tasks.map((task) => task.taskId)],
      receiptIds: [],
      files: fileOf(feature) ? [fileOf(feature) as string] : [],
      factSheet: `${text} ${feature.title} ${feature.text}`,
    };
  }

  private explainSearch(words: readonly string[]): GroundedText | null {
    if (words.length === 0) return null;
    const minRequired = words.length === 1 ? 1 : Math.min(words.length, Math.max(2, Math.ceil(words.length / 2)));

    const ftsQuery = words.join(" OR ");
    const ftsHits = this.db.searchNodes(ftsQuery, 10);
    const allActive = this.db.allNodes().filter((node) => !node.id.startsWith("__attempt_task:"));
    const candidates = new Map<string, GraphNode>();
    for (const node of ftsHits) {
      if (!node.id.startsWith("__attempt_task:")) candidates.set(node.id, node);
    }
    for (const node of allActive) {
      candidates.set(node.id, node);
    }

    let best: { node: GraphNode; score: number } | null = null;
    for (const node of candidates.values()) {
      const hay = haystack(node);
      const score = words.filter((word) => tokenInHaystack(hay, word)).length;
      if (score >= minRequired && (!best || score > best.score)) {
        best = { node, score };
      }
    }
    if (!best) return null;
    const first = best.node;
    if (first.kind === "feature") return this.explainFeatureNode(first);
    if (first.kind === "task") return this.explainWaiting(first.id);
    const excerpt = first.text.length > 400 ? first.text.slice(0, 400) : first.text;
    const summary = excerpt.length > 0 ? excerpt : first.title;
    const text = `Recorded in ${first.id}: ${summary}`;
    return {
      text,
      nodeIds: [first.id],
      receiptIds: [],
      files: fileOf(first) ? [fileOf(first) as string] : [],
      factSheet: `${text} ${first.title} ${JSON.stringify(first.fields)}`,
    };
  }

  private findTask(taskId: string): TaskFact | null {
    const node = this.db.getNode(taskId);
    const featureId = typeof node?.fields.feature === "string" ? node.fields.feature : "";
    const direct = this.db.tasksForFeature(featureId).find((task) => task.taskId === taskId);
    if (direct) return direct;
    return this.db.allTasks().find((task) => task.taskId === taskId) ?? null;
  }

  private decisionMatches(question: string, quote: string): boolean {
    const words = contentTokens(question);
    const hay = quote.toLowerCase();
    if (words.length === 0) return quote.trim().length > 0;
    return words.some((word) => hay.includes(word));
  }

  private disputeCard(quote: string, assertion: string): DecisionCard {
    const requirementCode = /\b([1-5]\d{2})\b/.exec(quote)?.[1];
    const checkCode = /\b([1-5]\d{2})\b/.exec(assertion)?.[1];
    const follow = requirementCode
      ? `Use ${requirementCode} from the requirement`
      : "Use the requirement wording";
    const keep = checkCode ? `Keep the sealed check at ${checkCode}` : "Keep the sealed check";
    const options: DecisionOption[] = [
      { id: "follow-requirement", label: follow, recommended: true },
      { id: "keep-check", label: keep, recommended: false },
      { id: "rewrite-both", label: "Rewrite the requirement and the check together", recommended: false },
    ];
    return {
      lines: three(
        "The requirement and the sealed check disagree.",
        `Requirement: "${quote}" | Sealed check: "${assertion}"`,
        "Recommended: change the sealed check so it matches the requirement.",
      ),
      options,
      recommendationId: oneRecommendation(options),
      requirementQuote: quote,
      sealedAssertion: assertion,
    };
  }

  private ambiguityCard(question: string): DecisionCard {
    const options: DecisionOption[] = [
      { id: "record-decision", label: "Write the choice into the spec", recommended: true },
      { id: "pause", label: "Pause the task until you decide", recommended: false },
      { id: "defer", label: "Defer this behavior to a later wave", recommended: false },
    ];
    const single = question.replace(/\s+/g, " ").trim();
    return {
      lines: three(
        "The task is blocked on a product choice that is not recorded yet.",
        `Question: ${single}`,
        "Recommended: write the choice into the spec before the worker continues.",
      ),
      options,
      recommendationId: oneRecommendation(options),
      requirementQuote: null,
      sealedAssertion: null,
    };
  }

  private async askModel(question: string, factSheet: string): Promise<ModelReply> {
    if (!this.model || factSheet.trim().length === 0) {
      return { invoked: false, schema: null };
    }
    const family = this.roster.find((entry) => entry.family !== this.workerFamily) ?? this.roster[0];
    const raw = await consultModel(this.model, {
      role: "ask-owner-responder@1",
      family: family?.family ?? "unconfigured",
      vision: false,
      prompt: buildAskOwnerPrompt(question, factSheet),
      imageBytes: 0,
    });
    if (raw === null) return { invoked: false, schema: null };
    const parsed = parseAskOwnerResponderV1(raw);
    if (!parsed.ok || isBlockedExit(parsed.value)) {
      return { invoked: true, schema: null };
    }
    return { invoked: true, schema: parsed.value };
  }

  private isGroundedModelReply(replyText: string, grounded: GroundedText): boolean {
    const trimmed = replyText.trim();
    if (trimmed.length === 0) return false;
    const factLower = grounded.factSheet.toLowerCase();
    const replyLower = trimmed.toLowerCase();

    if (
      /\b(not built|not started|planned|waiting|paused|0\/\d+\s+tasks\s+started)\b/i.test(grounded.factSheet) &&
      /\b(already live|live in production|in production|already built|already implemented|already deployed|all tasks completed)\b/i.test(
        trimmed,
      ) &&
      !factLower.includes("in production") &&
      !factLower.includes("already live")
    ) {
      return false;
    }

    if (
      /\bdid not all pass\b|\bfailed\b/i.test(grounded.factSheet) &&
      /\ball\b[^.]*\bpassed\b/i.test(trimmed) &&
      !/\bdid not all pass\b/i.test(trimmed)
    ) {
      return false;
    }
    if (
      /\bpassed\b/i.test(grounded.factSheet) &&
      !/\bfail(?:ed|ing|s)?\b|\bdid not\b/i.test(grounded.factSheet) &&
      /\bfail(?:ed|ing|s)?\b|\bdid not pass\b/i.test(trimmed)
    ) {
      return false;
    }

    const validIds = new Set<string>([
      ...grounded.nodeIds,
      ...grounded.receiptIds,
      ...this.db.nodeIds(),
      ...this.db.receiptIds(),
    ]);
    for (const mentioned of trimmed.match(ENTITY_ID_PATTERN) ?? []) {
      const cleaned = mentioned.replace(/[?.!,;:]+$/, "");
      if (!validIds.has(cleaned) && !grounded.factSheet.includes(cleaned)) {
        return false;
      }
    }

    for (const match of trimmed.matchAll(/\bwave\s+(\d+)\b/gi)) {
      const waveNum = match[1];
      if (waveNum && !new RegExp(`\\bwave\\s+${waveNum}\\b`, "i").test(grounded.factSheet)) {
        return false;
      }
    }

    const factTokens = contentTokens(grounded.factSheet);
    if (factTokens.length > 0) {
      const overlap = factTokens.filter((token) => tokenInHaystack(replyLower, token)).length;
      const required = Math.min(factTokens.length, 2);
      const citesGroundedId =
        grounded.nodeIds.some((id) => trimmed.includes(id)) ||
        grounded.receiptIds.some((id) => trimmed.includes(id));
      if (overlap < required && !citesGroundedId) {
        return false;
      }
    }

    return true;
  }

  private unknown(): OwnerAnswer {
    const text = "No recorded fact in state.db answers that. I will not guess.";
    return {
      schema: requireSchema({ kind: "answer", text, changes: [] }),
      card: null,
      citations: [],
      grounded: true,
      guessed: false,
      text,
      llmCalls: 0,
    };
  }

  private finish(
    kind: AskOwnerSchemaPayload["kind"],
    text: string,
    changes: readonly SchemaChange[],
    grounded: GroundedText & { card?: DecisionCard },
    llmCalls: number,
  ): OwnerAnswer {
    const citations = this.cite(grounded);
    return {
      schema: requireSchema({ kind, text, changes }),
      card: grounded.card ?? null,
      citations,
      grounded: true,
      guessed: false,
      text,
      llmCalls,
    };
  }

  private cite(grounded: GroundedText): readonly ClickableCitation[] {
    const ground = {
      files: this.db.filePaths(),
      nodeIds: this.db.nodeIds(),
      receiptIds: this.db.receiptIds(),
    };
    const citations: ClickableCitation[] = [];
    for (const id of grounded.nodeIds) {
      if (checkCitation({ nodeId: id }, ground).ok) {
        const node = this.db.getNode(id);
        citations.push({
          kind: "node",
          id,
          label: node && node.title.length > 0 ? node.title : id,
          href: `ef://node/${id}`,
        });
      }
    }
    for (const id of grounded.receiptIds) {
      if (checkCitation({ receiptId: id }, ground).ok) {
        citations.push({ kind: "receipt", id, label: id, href: `ef://receipt/${id}` });
      }
    }
    for (const filePath of grounded.files) {
      if (checkCitation({ filePath }, ground).ok) {
        citations.push({ kind: "file", id: filePath, label: filePath, href: `ef://file/${filePath}` });
      }
    }
    return citations;
  }
}
