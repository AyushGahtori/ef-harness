import { countSkeletonWords, parseArchitectOutput, wordBudgetViolation } from "./architect-schema.js";
import { DeterministicArchConsistencyGate } from "./consistency-gate.js";
import { quoteSkeletonDiagrams } from "./mermaid-syntax.js";
import { skeletonDraft } from "./persist-skeleton.js";
import { fatalPrecheck, isFatal, sharedOwners } from "./precheck.js";
import { ArchitectureStore, openArchitectureStore, type NodeDraft } from "./state-db.js";
import {
  MAX_REPAIR_PASSES,
  PHASE0_FOUNDATION,
  type ArchitectModelPort,
  type ArchitectureViolation,
  type SynthesisInput,
  type SynthesisResult,
  type SystemSkeleton,
  isRepairable,
  violation,
} from "./types.js";

export interface SynthesizerOptions {
  readonly model: ArchitectModelPort;
  readonly store?: ArchitectureStore;
  readonly contradictions?: { activeConflictCount(store: ArchitectureStore): number };
  readonly now?: () => number;
}

export class SystemArchitectureSynthesizer {
  readonly store: ArchitectureStore;
  private readonly model: ArchitectModelPort;
  private readonly contradictions: { activeConflictCount(store: ArchitectureStore): number };
  private readonly now: () => number;
  private readonly gate = new DeterministicArchConsistencyGate();

  constructor(options: SynthesizerOptions) {
    this.model = options.model;
    this.store = options.store ?? openArchitectureStore();
    this.contradictions = options.contradictions ?? graphContradictionEngine();
    this.now = options.now ?? (() => 1_700_000_000_000);
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const conflicts = this.contradictions.activeConflictCount(this.store);
    if (conflicts > 0) {
      return {
        started: false,
        accepted: false,
        repairPasses: 0,
        wordCount: 0,
        violations: [
          violation(
            "unresolved_contradictions",
            `SystemArchitectureSynthesizer refuses to start until active conflicts equal 0 (active conflicts: ${conflicts}).`,
          ),
        ],
        owners: {},
        diagnostic: null,
        refusal: { reason: "unresolved_contradictions", activeConflicts: conflicts },
      };
    }

    this.seed(input);
    let parsed = parseArchitectOutput(await this.complete(input, 0, []));
    let skeleton: SystemSkeleton | null = parsed.kind === "skeleton" ? parsed.skeleton : null;
    let blocking = this.openingViolations(parsed, input);
    let passes = 0;

    if (parsed.kind === "skeleton" && !blocking.some((item) => isFatal(item.code))) {
      blocking = await this.persistAndCheck(parsed.skeleton, input);
    }

    while (passes < MAX_REPAIR_PASSES && blocking.some((item) => isRepairable(item.code))) {
      passes += 1;
      parsed = parseArchitectOutput(await this.complete(input, passes, blocking));
      if (parsed.kind === "blocked") {
        blocking = [...parsed.violations];
        skeleton = null;
        break;
      }
      if (parsed.kind === "invalid") {
        blocking = [...parsed.violations];
        continue;
      }
      const repaired = quoteSkeletonDiagrams(parsed.skeleton);
      const fatal = fatalPrecheck(repaired, input);
      skeleton = repaired;
      if (fatal.length > 0) {
        blocking = fatal;
        break;
      }
      blocking = await this.persistAndCheck(repaired, input);
    }

    const accepted = blocking.length === 0 && skeleton !== null;
    const owners = skeleton ? sharedOwners(skeleton) : {};
    const wordCount = skeleton ? countSkeletonWords(skeleton) : 0;
    return {
      started: true,
      accepted,
      repairPasses: passes,
      wordCount,
      violations: blocking,
      owners,
      diagnostic: accepted
        ? null
        : {
            contractId: "system-architect@1",
            repairPasses: passes,
            violations: blocking,
            message: blocking.map((item) => item.message).join(" "),
          },
      refusal: null,
    };
  }

  private openingViolations(
    parsed: ReturnType<typeof parseArchitectOutput>,
    input: SynthesisInput,
  ): ArchitectureViolation[] {
    if (parsed.kind === "invalid" || parsed.kind === "blocked") return [...parsed.violations];
    return fatalPrecheck(parsed.skeleton, input);
  }

  private async persistAndCheck(skeleton: SystemSkeleton, input: SynthesisInput): Promise<ArchitectureViolation[]> {
    const seeded = new Set(this.store.listNodes().map((node) => node.id));
    const observed = new Set((input.observedSubsystems ?? []).map((item) => item.id));
    const draft = skeletonDraft(skeleton, seeded, observed);
    try {
      this.store.commitChangeSet(
        {
          author: "system-architect@1",
          summary: "system skeleton",
          nodes: draft.nodes,
          edges: draft.edges,
        },
        this.now(),
      );
    } catch (error) {
      return [persistenceViolation(error)];
    }
    const report = await this.gate.run(this.store);
    const budget = wordBudgetViolation(skeleton);
    return dedupe([...(budget ? [budget] : []), ...report.blocking]);
  }

  private async complete(
    input: SynthesisInput,
    repairPass: number,
    violations: readonly ArchitectureViolation[],
  ): Promise<string> {
    return this.model.complete({
      attempt: "system-architect@1",
      step: repairPass,
      contractId: "system-architect@1",
      repairPass,
      violations,
      prompt: buildPrompt(input, repairPass, violations),
    });
  }

  private seed(input: SynthesisInput): void {
    const nodes: NodeDraft[] = [
      {
        id: PHASE0_FOUNDATION,
        kind: "feature",
        title: "Phase 0 foundation",
        text: "Shared foundation owner for locked skeleton contracts.",
        fields: {
          feature: PHASE0_FOUNDATION,
          basis: "derived",
          arch_role: "feature",
          owner: PHASE0_FOUNDATION,
        },
        ownerRole: PHASE0_FOUNDATION,
      },
    ];
    for (const decision of input.decisions) {
      nodes.push({
        id: decision.id,
        kind: "decision",
        title: decision.title,
        text: decision.text,
        fields: { feature: PHASE0_FOUNDATION, basis: decision.basis },
      });
    }
    for (const requirement of input.requirements) {
      nodes.push({
        id: requirement.id,
        kind: requirement.kind,
        title: requirement.title,
        text: requirement.text,
        fields: { feature: PHASE0_FOUNDATION, basis: requirement.basis },
      });
    }
    for (const fact of input.researchFacts) {
      nodes.push({
        id: fact.id,
        kind: "research_fact",
        title: fact.title,
        text: fact.text,
        fields: { feature: PHASE0_FOUNDATION, basis: "observed" },
      });
    }
    for (const rule of input.crossCuttingRules) {
      nodes.push({
        id: rule.id,
        kind: "rule",
        title: rule.id,
        text: rule.text,
        fields: {
          feature: PHASE0_FOUNDATION,
          basis: "explicit",
          system_rule: true,
          scope_predicate: rule.scope,
          check_kind: rule.checkKind,
        },
      });
    }
    for (const observed of input.observedSubsystems ?? []) {
      nodes.push({
        id: observed.id,
        kind: "arch_node",
        title: observed.path,
        text: observed.signature,
        fields: {
          feature: PHASE0_FOUNDATION,
          basis: "observed",
          arch_role: "module",
          canonical_name: observed.id,
          level: observed.level,
          path: observed.path,
          observed: true,
        },
      });
    }
    this.store.commitChangeSet(
      { author: "system-architect@1", summary: "seed discovery, requirements, and research", nodes },
      this.now(),
    );
  }
}

export function graphContradictionEngine(): { activeConflictCount(store: ArchitectureStore): number } {
  return { activeConflictCount: (store) => store.countContradicts() };
}

function persistenceViolation(error: unknown): ArchitectureViolation {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("names.kind") || message.includes("UNIQUE constraint failed: names")) {
    return violation("shadowed_name", message);
  }
  if (message.includes("FOREIGN KEY")) return violation("dangling_ref", message);
  return violation("schema_invalid", message);
}

function dedupe(violations: readonly ArchitectureViolation[]): ArchitectureViolation[] {
  const seen = new Set<string>();
  const unique: ArchitectureViolation[] = [];
  for (const item of violations) {
    const key = `${item.code}\u0000${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function buildPrompt(
  input: SynthesisInput,
  repairPass: number,
  violations: readonly ArchitectureViolation[],
): string {
  const lines = [
    "contract: system-architect@1",
    "Design the smallest upfront system skeleton that satisfies every cited requirement.",
    "Stay within 2500 words. Do not write a 50-page monolith.",
    `mode: ${input.mode}`,
    `decisions: ${input.decisions.map((item) => item.id).join(", ")}`,
    `requirements: ${input.requirements.map((item) => item.id).join(", ")}`,
    `research: ${input.researchFacts.map((item) => item.id).join(", ")}`,
    `rules: ${input.crossCuttingRules.map((item) => item.id).join(", ")}`,
  ];
  if ((input.observedSubsystems ?? []).length > 0) {
    lines.push(
      `observed: ${(input.observedSubsystems ?? []).map((item) => `${item.id} ${item.level} ${item.path}`).join("; ")}`,
    );
  }
  if (repairPass > 0) {
    lines.push(`repair pass ${repairPass} of ${MAX_REPAIR_PASSES}`);
    lines.push(`violations: ${JSON.stringify(violations)}`);
  }
  return lines.join("\n");
}
