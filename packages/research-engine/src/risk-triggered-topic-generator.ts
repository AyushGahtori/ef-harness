import {
  assertSafeNonNegative,
  canonicalTopicHash,
  majorMinor,
  majorNumber,
  researchMicroUsdCap,
  researchTokenCap,
  type ResearchBudget,
  type StackPackage,
  type TopicDisposition,
  type TopicKind,
  type TopicSignal,
} from "./domain.js";

export interface GeneratedTopic {
  readonly id: string;
  readonly title: string;
  readonly kind: TopicKind;
  readonly riskScore: number;
  readonly uncertainty: number;
  readonly libraryName: string | null;
  readonly majorMinor: string | null;
  readonly docUrl: string | null;
  readonly targetNodeIds: readonly string[];
  readonly disposition: TopicDisposition;
  readonly topicHash: string;
  readonly estimatedTokens: number;
  readonly reason: string;
}

export interface TopicPlan {
  readonly topics: readonly GeneratedTopic[];
  readonly selected: readonly GeneratedTopic[];
  readonly deferred: readonly GeneratedTopic[];
  readonly skipped: readonly GeneratedTopic[];
  readonly tokenCap: number;
  readonly microUsdCap: number | null;
  readonly tokensReserved: number;
}

const TRIVIAL_TEXT =
  /\b(array\.map|console\.log|for loop|string concatenation|hello world|json\.parse|template literal|arrow function|language basic)\b/i;

const BUILTIN_LIBRARIES = new Set([
  "array",
  "string",
  "number",
  "object",
  "console",
  "math",
  "json",
  "promise",
  "map",
  "set",
]);

const FAST_MOVING = new Set([
  "stripe",
  "next",
  "react",
  "prisma",
  "playwright",
  "@playwright/test",
  "zod",
  "auth.js",
  "next-auth",
  "drizzle-orm",
  "openai",
]);

const DB_LIBRARIES = new Set([
  "prisma",
  "drizzle-orm",
  "typeorm",
  "sequelize",
  "knex",
  "pg",
  "better-sqlite3",
  "mysql2",
  "mongoose",
]);

const RISK: Record<TopicKind, number> = {
  security_compliance: 100,
  saas_webhook_oauth: 90,
  major_version_api: 80,
  stack_compatibility: 75,
  windows_native: 70,
  db_driver_orm: 60,
  library: 55,
  cross_cutting_risk: 50,
  feature_risk: 40,
};

export class RiskTriggeredTopicGenerator {
  generate(input: {
    readonly stack?: readonly StackPackage[];
    readonly signals: readonly TopicSignal[];
    readonly budget: ResearchBudget;
  }): TopicPlan {
    const tokensPerTopic = input.budget.tokensPerTopic;
    assertSafeNonNegative(tokensPerTopic, "tokensPerTopic");
    if (tokensPerTopic < 1) throw new Error("tokensPerTopic must be at least 1");
    const tokenCap = researchTokenCap(input.budget.waveTokenBudget);
    const microUsdCap =
      input.budget.waveMicroUsd === undefined ? null : researchMicroUsdCap(input.budget.waveMicroUsd);
    const microUsdPerTopic = input.budget.microUsdPerTopic ?? 0;
    if (input.budget.microUsdPerTopic !== undefined) {
      assertSafeNonNegative(input.budget.microUsdPerTopic, "microUsdPerTopic");
    }

    const drafted: DraftTopic[] = [];
    const stack = input.stack ?? [];
    if (stack.length > 0) drafted.push(stackTopic(stack));
    for (const signal of input.signals) drafted.push(classifySignal(signal));

    const candidates = drafted
      .filter((topic) => topic.disposition !== "skipped_trivial")
      .sort((left, right) => {
        if (right.riskScore !== left.riskScore) return right.riskScore - left.riskScore;
        if (right.uncertainty !== left.uncertainty) return right.uncertainty - left.uncertainty;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });

    const selectedIds = new Set<string>();
    let tokensReserved = 0;
    let microReserved = 0;
    for (const topic of candidates) {
      const nextTokens = tokensReserved + tokensPerTopic;
      const nextMicro = microReserved + microUsdPerTopic;
      if (nextTokens > tokenCap) continue;
      if (microUsdCap !== null && nextMicro > microUsdCap) continue;
      selectedIds.add(topic.id);
      tokensReserved = nextTokens;
      microReserved = nextMicro;
    }

    const topics = drafted.map((topic) => {
      if (topic.disposition === "skipped_trivial") return finish(topic, "skipped_trivial", tokensPerTopic);
      const disposition: TopicDisposition = selectedIds.has(topic.id)
        ? "selected"
        : "deferred_to_installed_types";
      return finish(topic, disposition, tokensPerTopic);
    });

    return {
      topics,
      selected: topics.filter((topic) => topic.disposition === "selected"),
      deferred: topics.filter((topic) => topic.disposition === "deferred_to_installed_types"),
      skipped: topics.filter((topic) => topic.disposition === "skipped_trivial"),
      tokenCap,
      microUsdCap,
      tokensReserved,
    };
  }
}

interface DraftTopic {
  readonly id: string;
  readonly title: string;
  readonly kind: TopicKind;
  readonly riskScore: number;
  readonly uncertainty: number;
  readonly libraryName: string | null;
  readonly majorMinor: string | null;
  readonly docUrl: string | null;
  readonly targetNodeIds: readonly string[];
  readonly disposition: "candidate" | "skipped_trivial";
  readonly reason: string;
}

function finish(topic: DraftTopic, disposition: TopicDisposition, estimatedTokens: number): GeneratedTopic {
  const topicHash = canonicalTopicHash({
    kind: topic.kind,
    title: topic.title,
    libraryName: topic.libraryName,
    majorMinor: topic.majorMinor,
  });
  return {
    id: topic.id,
    title: topic.title,
    kind: topic.kind,
    riskScore: topic.riskScore,
    uncertainty: topic.uncertainty,
    libraryName: topic.libraryName,
    majorMinor: topic.majorMinor,
    docUrl: topic.docUrl,
    targetNodeIds: topic.targetNodeIds,
    disposition,
    topicHash,
    estimatedTokens,
    reason: topic.reason,
  };
}

function stackTopic(stack: readonly StackPackage[]): DraftTopic {
  const title = `Stack compatibility: ${stack.map((item) => `${item.name}@${item.version}`).join(", ")}`;
  return {
    id: "stack-compatibility",
    title,
    kind: "stack_compatibility",
    riskScore: RISK.stack_compatibility,
    uncertainty: 2,
    libraryName: stack[0]?.name ?? null,
    majorMinor: majorMinor(stack[0]?.version),
    docUrl: null,
    targetNodeIds: [],
    disposition: "candidate",
    reason: "one stack-compatibility topic is always generated from the chosen versions",
  };
}

function classifySignal(signal: TopicSignal): DraftTopic {
  const text = `${signal.title}\n${signal.text ?? ""}`;
  const tags = new Set((signal.riskTags ?? []).map((tag) => tag.toLowerCase().replace(/[\s-]+/g, "_")));
  const library = signal.libraryName?.trim() || null;
  const fromMajor = majorNumber(signal.fromVersion);
  const toMajor = majorNumber(signal.toVersion);
  const toMinor = majorMinor(signal.toVersion) ?? majorMinor(signal.fromVersion);
  const majorBump = fromMajor !== null && toMajor !== null && fromMajor !== toMajor;
  const minorBump =
    !majorBump &&
    majorMinor(signal.fromVersion) !== null &&
    majorMinor(signal.toVersion) !== null &&
    majorMinor(signal.fromVersion) !== majorMinor(signal.toVersion);
  const trivial =
    signal.kindHint === "language_basic" ||
    (tags.size === 0 &&
      !majorBump &&
      !minorBump &&
      signal.kindHint !== "service" &&
      signal.kindHint !== "native" &&
      signal.kindHint !== "database" &&
      signal.kindHint !== "security" &&
      (TRIVIAL_TEXT.test(text) || (library !== null && BUILTIN_LIBRARIES.has(library.toLowerCase()))));

  if (trivial) {
    return draft(signal, "feature_risk", 0, "skipped_trivial", library, toMinor, "well-known language basic; no external research");
  }

  const kind = kindOf(signal, tags, library, majorBump, minorBump, text);
  const uncertainty = (signal.toVersion ? 0 : 4) + (majorBump ? 3 : minorBump ? 2 : 0);
  return draft(signal, kind, uncertainty, "candidate", library, toMinor, reasonFor(kind));
}

function kindOf(
  signal: TopicSignal,
  tags: ReadonlySet<string>,
  library: string | null,
  majorBump: boolean,
  minorBump: boolean,
  text: string,
): TopicKind {
  if (
    signal.kindHint === "security" ||
    tags.has("security") ||
    tags.has("compliance") ||
    /\b(csrf|oauth scope|encryption|pci|gdpr|secret rotation)\b/i.test(text)
  ) {
    return "security_compliance";
  }
  if (
    signal.kindHint === "service" ||
    tags.has("webhook") ||
    tags.has("oauth") ||
    /\b(webhook signature|oauth)\b/i.test(text)
  ) {
    return "saas_webhook_oauth";
  }
  if (majorBump || (minorBump && library !== null && FAST_MOVING.has(library.toLowerCase()))) {
    return "major_version_api";
  }
  if (
    signal.kindHint === "native" ||
    tags.has("windows") ||
    tags.has("native") ||
    /\b(node-gyp|win32|windows api|native binding)\b/i.test(text)
  ) {
    return "windows_native";
  }
  if (
    signal.kindHint === "database" ||
    tags.has("db") ||
    tags.has("orm") ||
    (library !== null && DB_LIBRARIES.has(library.toLowerCase())) ||
    /\b(orm|query driver|migration lock)\b/i.test(text)
  ) {
    return "db_driver_orm";
  }
  if (
    tags.has("auth") ||
    tags.has("money") ||
    tags.has("time") ||
    tags.has("concurrency") ||
    tags.has("personal_data") ||
    tags.has("files") ||
    tags.has("realtime")
  ) {
    return "cross_cutting_risk";
  }
  if (library) return "library";
  return "feature_risk";
}

function reasonFor(kind: TopicKind): string {
  switch (kind) {
    case "security_compliance":
      return "security or compliance primitive";
    case "saas_webhook_oauth":
      return "external SaaS webhook signature or OAuth flow";
    case "major_version_api":
      return "major or fast-moving library API change";
    case "stack_compatibility":
      return "stack compatibility";
    case "windows_native":
      return "Windows-specific native binding";
    case "db_driver_orm":
      return "database driver or ORM quirk";
    case "library":
      return "chosen library is not covered by the research cache";
    case "cross_cutting_risk":
      return "cross-cutting risk tag";
    case "feature_risk":
      return "feature risk tag with no broader topic";
  }
}

function draft(
  signal: TopicSignal,
  kind: TopicKind,
  uncertainty: number,
  disposition: DraftTopic["disposition"],
  libraryName: string | null,
  version: string | null,
  reason: string,
): DraftTopic {
  return {
    id: signal.id,
    title: signal.title,
    kind,
    riskScore: disposition === "skipped_trivial" ? 0 : RISK[kind],
    uncertainty,
    libraryName,
    majorMinor: version,
    docUrl: signal.docUrl ?? null,
    targetNodeIds: signal.targetNodeIds ?? [],
    disposition,
    reason,
  };
}
