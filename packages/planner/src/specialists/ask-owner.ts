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
  SchemaChange,
  SpecialistModel,
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
  "a", "an", "the", "did", "do", "we", "you", "is", "are", "was", "were", "yet",
  "add", "added", "have", "has", "how", "what", "which", "why", "when", "where",
  "task", "tests", "test", "pass", "passed", "stores", "store", "database",
  "table", "for", "this", "that", "with", "from", "into", "your", "waiting",
]);

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

function contentTokens(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP.has(token));
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

  answerQuestion(question: string): OwnerAnswer {
    const grounded = this.lookup(question.trim());
    if (!grounded) return this.unknown();
    this.askModel(question, grounded.factSheet);
    return this.finish("answer", grounded.text, [], grounded);
  }

  formatWorkerEscalation(request: WorkerEscalationRequest): OwnerAnswer {
    if (request.recordedDecision && this.decisionMatches(request.question, request.recordedDecision.quote)) {
      const text = `This is already decided: ${request.recordedDecision.quote}`;
      const changes: SchemaChange[] = [{ target_id: request.taskId, text: request.recordedDecision.quote }];
      this.askModel(request.question, text);
      return this.finish("brief_fix", text, changes, {
        text,
        nodeIds: [request.recordedDecision.id, request.taskId],
        receiptIds: [],
        files: [],
        factSheet: text,
      });
    }
    const card = request.requirementQuote && request.sealedAssertion
      ? this.disputeCard(request.requirementQuote, request.sealedAssertion)
      : this.ambiguityCard(request.question);
    const text = card.lines.join("\n");
    this.askModel(request.question, `${text}\n${request.logs}\n${request.diffSummary}`);
    return this.finish("escalate", text, [], {
      text,
      nodeIds: [request.requirementId, request.checkId, request.taskId].filter((id): id is string => Boolean(id)),
      receiptIds: [],
      files: [],
      factSheet: text,
      card,
    });
  }

  resolveDisputeChoice(request: WorkerEscalationRequest, optionId: string): OwnerAnswer {
    const quote = request.requirementQuote ?? "";
    const assertion = request.sealedAssertion ?? "";
    const card = this.disputeCard(quote, assertion);
    if (optionId === "follow-requirement") {
      const target = request.checkId ?? request.requirementId ?? request.taskId;
      const text = `Use the requirement and update the sealed check. Requirement: ${quote}`;
      return this.finish("dispute_upheld", text, [{ target_id: target, text: quote }], {
        text,
        nodeIds: [request.requirementId, request.checkId].filter((id): id is string => Boolean(id)),
        receiptIds: [],
        files: [],
        factSheet: text,
        card,
      });
    }
    if (optionId === "keep-check") {
      const text = `Keep the sealed check as written. Sealed check: ${assertion}`;
      return this.finish("dispute_rejected", text, [], {
        text,
        nodeIds: [request.checkId, request.requirementId].filter((id): id is string => Boolean(id)),
        receiptIds: [],
        files: [],
        factSheet: text,
        card,
      });
    }
    const text = card.lines.join("\n");
    return this.finish("escalate", text, [], {
      text,
      nodeIds: [request.taskId],
      receiptIds: [],
      files: [],
      factSheet: text,
      card,
    });
  }

  private lookup(question: string): (GroundedText & { card?: DecisionCard }) | null {
    const waiting = /why is task\s+([A-Za-z0-9._-]+)/i.exec(question);
    if (waiting?.[1]) return this.explainWaiting(waiting[1]);
    const table = /which database table stores\s+([a-z0-9 _-]+)/i.exec(question);
    if (table?.[1]) return this.explainTable(table[1].trim());
    if (/auth tests/i.test(question)) return this.explainReceipts("auth", "Auth tests");
    if (/stripe/i.test(question) && /webhook/i.test(question)) return this.explainFeature(["stripe", "webhook"]);
    const words = contentTokens(question);
    if (/did we add|have we added/i.test(question) && words.length > 0) return this.explainFeature(words);
    return this.explainSearch(words);
  }

  private explainWaiting(taskId: string): GroundedText | null {
    const node = this.db.getNode(taskId);
    const tasks = this.db.tasksForFeature(node?.fields.feature as string ?? "");
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
    const node = this.db.getNode(first.ownerNodeId);
    return {
      text,
      nodeIds: [first.ownerNodeId],
      receiptIds: [],
      files: node && fileOf(node) ? [fileOf(node) as string] : [],
      factSheet: `${text} ${first.title} ${first.text}`,
    };
  }

  private explainReceipts(topic: string, label: string): GroundedText | null {
    const receipts = this.db.receiptsAbout(topic);
    if (receipts.length === 0) return null;
    const failed = receipts.filter((receipt) => receipt.status !== "pass");
    const text = failed.length === 0
      ? `${label} passed (receipt ${receipts.map((receipt) => receipt.receiptId).join(", ")}).`
      : `${label} did not all pass. ${failed.map((receipt) => `${receipt.checkId} is ${receipt.status} (receipt ${receipt.receiptId})`).join(" ")}`;
    return {
      text,
      nodeIds: receipts.map((receipt) => receipt.checkId),
      receiptIds: receipts.map((receipt) => receipt.receiptId),
      files: [],
      factSheet: text,
    };
  }

  private explainFeature(words: string[]): GroundedText | null {
    const feature = this.db.nodesOfKind("feature").find((node) =>
      words.every((word) => haystack(node).includes(word) || haystack(node).includes(word.replace(/s$/, ""))),
    );
    if (!feature) return null;
    const tasks = this.db.tasksForFeature(feature.id);
    const started = tasks.filter((task) => !NOT_STARTED.has(task.state)).length;
    const total = tasks.length;
    const wave = waveOf(feature);
    const text = wave === null
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
    const hits = this.db.nodesOfKind("decision").concat(this.db.nodesOfKind("spec_item"), this.db.nodesOfKind("rule"))
      .filter((node) => words.every((word) => haystack(node).includes(word)));
    const first = hits[0];
    if (!first) return null;
    const excerpt = first.text.length > 400 ? first.text.slice(0, 400) : first.text;
    const text = `Recorded in ${first.id}: ${excerpt}`;
    return {
      text,
      nodeIds: [first.id],
      receiptIds: [],
      files: fileOf(first) ? [fileOf(first) as string] : [],
      factSheet: text,
    };
  }

  private findTask(taskId: string): TaskFact | null {
    const node = this.db.getNode(taskId);
    const featureId = typeof node?.fields.feature === "string" ? node.fields.feature : "";
    const direct = this.db.tasksForFeature(featureId).find((task) => task.taskId === taskId);
    if (direct) return direct;
    for (const feature of this.db.nodesOfKind("feature")) {
      const found = this.db.tasksForFeature(feature.id).find((task) => task.taskId === taskId);
      if (found) return found;
    }
    return null;
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

  private askModel(question: string, factSheet: string): void {
    if (!this.model || factSheet.trim().length === 0) return;
    const family = this.roster.find((entry) => entry.family !== this.workerFamily) ?? this.roster[0];
    consultModel(this.model, {
      role: "ask-owner-responder@1",
      family: family?.family ?? "unconfigured",
      vision: false,
      prompt: buildAskOwnerPrompt(question, factSheet),
      imageBytes: 0,
    });
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
    };
  }

  private finish(
    kind: AskOwnerSchemaPayload["kind"],
    text: string,
    changes: readonly SchemaChange[],
    grounded: GroundedText & { card?: DecisionCard },
  ): OwnerAnswer {
    const citations = this.cite(grounded);
    return {
      schema: requireSchema({ kind, text, changes }),
      card: grounded.card ?? null,
      citations,
      grounded: true,
      guessed: false,
      text,
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
        citations.push({ kind: "node", id, href: `ef://node/${id}` });
      }
    }
    for (const id of grounded.receiptIds) {
      if (checkCitation({ receiptId: id }, ground).ok) {
        citations.push({ kind: "receipt", id, href: `ef://receipt/${id}` });
      }
    }
    for (const path of grounded.files) {
      if (checkCitation({ filePath: path }, ground).ok) {
        citations.push({ kind: "file", id: path, href: `ef://file/${path}` });
      }
    }
    return citations;
  }
}
