import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  APPROVED_BASES,
  BatchResolveV1Schema,
  BlindBinderV1Schema,
  COCKPIT_EXPLAINER_MAX_SENTENCES,
  CiTriageV1Schema,
  CockpitExplainerV1Schema,
  FeaturePlannerV1Schema,
  FeatureResearcherV1Schema,
  FinalProjectAuditorV1Schema,
  IntakeExtractorV1Schema,
  InvestigatorV1Schema,
  IssueTriageV1Schema,
  LeafWorkerV1Schema,
  LocatorSchema,
  PROMPT_CONTRACTS,
  PROMPT_CONTRACT_IDS,
  ReviewerV1Schema,
  RouterV1Schema,
  SpecExpanderV1Schema,
  TasteReviewerV1Schema,
  TurnSummarizerV1Schema,
  TURN_SUMMARIZER_MAX_TOKENS,
  estimatePromptTokens,
} from "../../src/prompts/index.js";
import { VALID_OUTPUTS } from "./fixtures.js";

function explain(schema: z.ZodTypeAny, payload: unknown): string {
  const parsed = schema.safeParse(payload);
  return parsed.success ? "ok" : JSON.stringify(parsed.error.issues, null, 2);
}

function walk(schema: z.ZodTypeAny, seen: Set<z.ZodTypeAny>, enums: string[][]): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown || schema instanceof z.ZodRecord) {
    throw new Error(`open schema ${schema.constructor.name}`);
  }
  if (schema instanceof z.ZodEnum) {
    enums.push((schema.options as unknown[]).map((option) => String(option)));
    return;
  }
  if (
    schema instanceof z.ZodString ||
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodBigInt ||
    schema instanceof z.ZodDate ||
    schema instanceof z.ZodLiteral ||
    schema instanceof z.ZodNativeEnum ||
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodUndefined ||
    schema instanceof z.ZodNever ||
    schema instanceof z.ZodVoid
  ) {
    return;
  }
  if (schema instanceof z.ZodObject) {
    if (schema._def.unknownKeys !== "strict") {
      throw new Error("object is not strict");
    }
    for (const child of Object.values(schema.shape)) {
      walk(child as z.ZodTypeAny, seen, enums);
    }
    return;
  }
  if (schema instanceof z.ZodArray) {
    walk(schema.element, seen, enums);
    return;
  }
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    for (const option of schema.options) walk(option, seen, enums);
    return;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    walk(schema.unwrap(), seen, enums);
    return;
  }
  if (schema instanceof z.ZodDefault) {
    walk(schema.removeDefault(), seen, enums);
    return;
  }
  if (schema instanceof z.ZodEffects) {
    walk(schema.innerType(), seen, enums);
    return;
  }
  if (schema instanceof z.ZodTuple) {
    for (const item of schema.items) walk(item, seen, enums);
    return;
  }
  if (schema instanceof z.ZodBranded) {
    walk(schema.unwrap(), seen, enums);
    return;
  }
  throw new Error(`unwalked ${schema.constructor.name}`);
}

const finding = {
  requirement: "SI-212",
  location: "src/kitchen/page.tsx:12",
  detail: "The print button is not rendered.",
};

describe("prompt output schemas", () => {
  it("uses a strict object for every contract, including the honest exit", () => {
    const enums: string[][] = [];
    for (const id of PROMPT_CONTRACT_IDS) {
      walk(PROMPT_CONTRACTS[id].output, new Set(), enums);
    }
    const basisMarkers = ["explicit", "derived", "delegated", "defaulted", "proposed"];
    const banned = ["chosen under delegation", "inferred", "assumed", "user-stated", "asked"];
    for (const options of enums) {
      for (const option of options) {
        if (option === "asked") continue;
        expect(banned).not.toContain(option);
      }
      const isBasisEnum = options.some((option) => basisMarkers.includes(option));
      if (!isBasisEnum) continue;
      for (const option of options) {
        expect(
          (APPROVED_BASES as readonly string[]).includes(option),
          options.join(" | "),
        ).toBe(true);
      }
    }
  });

  it("accepts a valid payload and a blocked exit for every contract", () => {
    for (const id of PROMPT_CONTRACT_IDS) {
      const schema = PROMPT_CONTRACTS[id].output;
      expect(explain(schema, VALID_OUTPUTS[id]), id).toBe("ok");
      expect(
        explain(schema, { blocked: true, reason: "The source is missing.", missing_ids: ["D-12"] }),
        `${id} blocked`,
      ).toBe("ok");
    }
  });

  it("rejects an extra key on every contract", () => {
    for (const id of PROMPT_CONTRACT_IDS) {
      const schema = PROMPT_CONTRACTS[id].output;
      expect(explain(schema, { ...VALID_OUTPUTS[id], approved: true }), id).not.toBe("ok");
      expect(
        explain(schema, { blocked: true, reason: "missing", approved: true }),
        `${id} blocked extra`,
      ).not.toBe("ok");
    }
  });

  it("enforces batch-resolve basis only when status is settled", () => {
    const valid = VALID_OUTPUTS["batch-resolve@1"];
    expect(explain(BatchResolveV1Schema, { ...valid, status: "settled", basis: null })).not.toBe(
      "ok",
    );
    expect(
      explain(BatchResolveV1Schema, { ...valid, status: "missing", basis: "explicit", value: null }),
    ).not.toBe("ok");
    expect(
      explain(BatchResolveV1Schema, { ...valid, status: "partial", basis: "derived", value: null }),
    ).not.toBe("ok");
    expect(
      explain(BatchResolveV1Schema, {
        ...valid,
        status: "conflict",
        basis: "delegated",
        value: null,
      }),
    ).not.toBe("ok");
    for (const basis of ["proposed", "defaulted", "observed", "asked", "chosen under delegation"]) {
      expect(explain(BatchResolveV1Schema, { ...valid, basis }), basis).not.toBe("ok");
    }
    expect(
      explain(BatchResolveV1Schema, {
        criterion: "delivery.recipient",
        question: "Q17",
        status: "missing",
        basis: null,
        value: null,
        evidence: [],
        rule: null,
        premises: [],
        delegation: null,
        conflict: null,
        missing_detail: "Who receives the emailed totals",
      }),
    ).toBe("ok");
    const parsed = BatchResolveV1Schema.parse({
      ...valid,
      evidence: [{ turn: "T7", start: 0, end: 6, quote: " Email" }],
    });
    if ("blocked" in parsed) throw new Error("expected the success branch");
    expect(parsed.evidence[0]?.quote).toBe(" Email");
  });

  it("rejects a complete audit when any finding list is non-empty", () => {
    const empty = VALID_OUTPUTS["final-project-auditor@1"];
    expect(explain(FinalProjectAuditorV1Schema, empty)).toBe("ok");
    expect(explain(FinalProjectAuditorV1Schema, { ...empty, missing: [finding] })).not.toBe("ok");
    expect(explain(FinalProjectAuditorV1Schema, { ...empty, stubbed: [finding] })).not.toBe("ok");
    expect(
      explain(FinalProjectAuditorV1Schema, { ...empty, unhandled_edge_cases: [finding] }),
    ).not.toBe("ok");
    expect(
      explain(FinalProjectAuditorV1Schema, {
        ...empty,
        weak_checks: [{ check: "AC-31", requirement: "SI-212", why: "It only checks the title." }],
      }),
    ).not.toBe("ok");
    expect(
      explain(FinalProjectAuditorV1Schema, {
        ...empty,
        verdict: "incomplete",
        missing: [finding],
      }),
    ).toBe("ok");
  });

  it("requires a research quote of at least 10 trimmed characters", () => {
    const valid = VALID_OUTPUTS["feature-researcher@1"] as {
      claims: { source: { quote: string } }[];
    };
    const withQuote = (quote: string) => {
      const claims = structuredClone(valid.claims);
      const claim = claims[0];
      if (!claim) throw new Error("missing claim");
      claim.source.quote = quote;
      return { ...valid, claims };
    };
    expect(explain(FeatureResearcherV1Schema, withQuote("too short"))).not.toBe("ok");
    expect(explain(FeatureResearcherV1Schema, withQuote("   123456789   "))).not.toBe("ok");
    expect(explain(FeatureResearcherV1Schema, withQuote("   1234567890   "))).toBe("ok");
  });

  it("accepts spec-expander proposed or asked, and never a legacy basis", () => {
    const cell = (VALID_OUTPUTS["spec-expander@1"] as { cells: object[] }).cells[0];
    expect(
      explain(SpecExpanderV1Schema, {
        cells: [{ ...cell, basis: null, status: "asked", value: null }],
      }),
    ).toBe("ok");
    expect(
      explain(SpecExpanderV1Schema, {
        cells: [{ ...cell, basis: "proposed", status: "asked" }],
      }),
    ).not.toBe("ok");
    expect(
      explain(SpecExpanderV1Schema, {
        cells: [{ ...cell, basis: "asked", status: null }],
      }),
    ).not.toBe("ok");
    expect(
      explain(SpecExpanderV1Schema, {
        cells: [{ ...cell, ears_text: "Show an empty state." }],
      }),
    ).not.toBe("ok");
  });

  it("accepts every router intent and every CI failure class", () => {
    const intents = [
      "question",
      "change",
      "correct_evidence",
      "add",
      "remove",
      "explain_impact",
      "new_feature",
      "control",
    ] as const;
    expect(
      explain(RouterV1Schema, {
        clauses: intents.map((intent, index) => ({
          span: { start: index, end: index + 2 },
          intent,
          target_id: intent === "question" || intent === "add" ? null : "SI-212",
          confidence: 0.5,
          needs_clarification: intent === "change" ? false : false,
        })),
      }),
    ).toBe("ok");
    expect(
      explain(RouterV1Schema, {
        clauses: [
          {
            span: { start: 0, end: 4 },
            intent: "rename",
            target_id: null,
            confidence: 1,
            needs_clarification: false,
          },
        ],
      }),
    ).not.toBe("ok");
    for (const failure of ["platform", "missing_secret", "flaky", "regression", "infrastructure"]) {
      expect(
        explain(CiTriageV1Schema, {
          class: failure,
          evidence_lines: ["the job failed"],
          suggested_owner: "platform",
        }),
        failure,
      ).toBe("ok");
    }
  });

  it("forbids expected values on blind-binder and requires advisory true on taste review", () => {
    const binder = VALID_OUTPUTS["blind-binder@1"];
    expect(explain(BlindBinderV1Schema, { ...binder, expectations: ["Soup x 2"] })).not.toBe("ok");
    expect(explain(BlindBinderV1Schema, { ...binder, expected: "Soup x 2" })).not.toBe("ok");
    const fields = {
      fields: [{ name: "expected_total", type: "number" }],
    };
    expect(
      explain(BlindBinderV1Schema, { ...binder, observations_schema: fields }),
    ).not.toBe("ok");
    expect(explain(TasteReviewerV1Schema, { findings: [] })).not.toBe("ok");
    expect(explain(TasteReviewerV1Schema, { advisory: false, findings: [] })).not.toBe("ok");
    expect(explain(TasteReviewerV1Schema, { advisory: true, findings: [] })).toBe("ok");
  });

  it("caps cockpit explanations at two sentences and turn summaries at the token budget", () => {
    const essay = Array.from({ length: 10 }, (_, index) => `Paragraph ${index + 1} keeps going.`).join(
      " ",
    );
    expect(explain(CockpitExplainerV1Schema, { text: essay })).not.toBe("ok");
    expect(
      explain(CockpitExplainerV1Schema, { text: "x".repeat(501) }),
    ).not.toBe("ok");
    expect(COCKPIT_EXPLAINER_MAX_SENTENCES).toBe(2);
    const note = "x".repeat(TURN_SUMMARIZER_MAX_TOKENS * 4 + 1);
    expect(estimatePromptTokens(note)).toBeGreaterThan(TURN_SUMMARIZER_MAX_TOKENS);
    expect(explain(TurnSummarizerV1Schema, { progress_note: note })).not.toBe("ok");
    expect(explain(TurnSummarizerV1Schema, VALID_OUTPUTS["turn-summarizer@1"])).toBe("ok");
  });

  it("rejects a fractional attempt and an unknown touches tag", () => {
    const worker = VALID_OUTPUTS["leaf-worker@1"];
    expect(explain(LeafWorkerV1Schema, { ...worker, attempt: 1.5 })).not.toBe("ok");
    expect(explain(LeafWorkerV1Schema, { ...worker, approved: true })).not.toBe("ok");
    const plan = VALID_OUTPUTS["feature-planner@1"] as {
      tasks: { touches: string[] }[];
    };
    const tasks = structuredClone(plan.tasks);
    const task = tasks[0];
    if (!task) throw new Error("missing task");
    task.touches = ["payments_stripe"];
    expect(explain(FeaturePlannerV1Schema, { ...plan, tasks })).not.toBe("ok");
  });

  it("accepts an investigator root cause and a documented experiment without the discriminator", () => {
    expect(
      explain(InvestigatorV1Schema, {
        hypothesis: "The handler swallows the print error.",
        experiment: "Click Print with the console open.",
        expected_if_true: "A TypeError is logged.",
        expected_if_false: "No error is logged.",
      }),
    ).toBe("ok");
    expect(
      explain(InvestigatorV1Schema, {
        root_cause: "print.ts never calls window.print.",
        evidence: ["src/kitchen/print.ts:12 returns before the call."],
        minimal_change: "Call window.print after the rows are built.",
      }),
    ).toBe("ok");
    expect(
      explain(InvestigatorV1Schema, {
        hypothesis: "both",
        root_cause: "both",
        experiment: "x",
        expected_if_true: "y",
        expected_if_false: "z",
        evidence: ["e"],
        minimal_change: "m",
      }),
    ).not.toBe("ok");
  });

  it("rejects an ok review that still lists findings", () => {
    expect(
      explain(ReviewerV1Schema, {
        verdict: "ok",
        findings: [
          {
            kind: "special_casing",
            location: "src/kitchen/print.ts:4",
            explanation: "The branch matches the example string.",
          },
        ],
      }),
    ).not.toBe("ok");
  });

  it("accepts Task 008 candidate@1 intent shapes and external-intake region image locators", () => {
    const worker = VALID_OUTPUTS["leaf-worker@1"] as Record<string, unknown>;
    expect(
      explain(LeafWorkerV1Schema, {
        ...worker,
        dependency_intents: [{ package: "zod", version: "^3.25.0", reason: "schemas" }],
        migration_intents: [
          {
            table: "orders",
            change: { add_column: { name: "pickup_slot", type: "text", nullable: true } },
            reason: "SI-401",
          },
        ],
        wiring_needs: [
          { kind: "route", path: "/kitchen", component: "KitchenPage" },
          { kind: "barrel", module: "src/index.ts", export_name: "KitchenPage" },
          { kind: "lockfile", package: "zod" },
          { kind: "schema_index", name: "orders" },
        ],
      }),
    ).toBe("ok");
    expect(
      explain(IntakeExtractorV1Schema, {
        statements: [
          {
            text: "Cutoff banner",
            locator: { kind: "image", region: [0, 0, 120, 40], ocr_text: "Cutoff 10:45" },
            kind: "rule",
            criterion_id: null,
            value: null,
          },
          {
            text: "Cutoff paragraph",
            locator: { kind: "pdf", page: 12, charStart: 10, charEnd: 40 },
            kind: "rule",
            criterion_id: null,
            value: null,
          },
        ],
        suspicious_instructions: [],
      }),
    ).toBe("ok");
    expect(
      explain(IntakeExtractorV1Schema, {
        statements: [
          {
            text: "Zero-length span",
            locator: { kind: "turn", turn: "T1", start: 4, end: 4 },
            kind: "rule",
            criterion_id: null,
            value: null,
          },
        ],
        suspicious_instructions: [],
      }),
    ).not.toBe("ok");
    expect(
      explain(IssueTriageV1Schema, {
        ...(VALID_OUTPUTS["issue-triage@1"] as Record<string, unknown>),
        title: {
          text: "Blank title span",
          locator: { kind: "docx", paragraph: 1, charStart: 5, charEnd: 5 },
        },
      }),
    ).not.toBe("ok");
    expect(LocatorSchema.safeParse({ kind: "spec", pointer: "/paths/~1orders" }).success).toBe(true);
  });
});
