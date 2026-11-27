import { describe, expect, it } from "vitest";
import {
  DenominatorDeltaExplainer,
  activeQuestions,
  activationTable,
  deriveWave1Flags,
  layer1Warnings,
  questionsForPrompt,
} from "./port/activate.js";
import { loadWave1Bundle, type CatalogQuestion, type WaveBundle } from "./port/load.js";
import {
  AsymmetricConflictError,
  CorpusQualityValidator,
  InsufficientExamplesError,
  MustAskPolicyFloorError,
  PrerequisiteCycleError,
  UnrecognizedTouchesTagError,
  assertDomainOracles,
} from "./port/quality.js";
import {
  M2_QUESTION_IDS,
  StageCoherenceSelfTest,
  combinedStageCatalog,
  m2StagePort,
  type StageCatalog,
} from "./port/stage.js";
import { TOUCHES_TAGS } from "./port/tags.js";

const KITCHEN =
  "Office kitchen meal ordering web app: staff open a link on their phones to pick daily lunch before the 11:00 AM cutoff, kitchen views printable daily summary and emails totals to catering. No billing and no AI.";
const EXPENSE_CLI = "Local expense CLI for one person. Upload a photo of the receipt. No billing and no AI.";
const STRIPE = "Add a paid Pro tier with Stripe";
const PAID_SAAS = "Paid SaaS with a Pro tier on Stripe and transactional email receipts.";
const RAG = "AI chat over uploaded company PDFs";

const KITCHEN_SETTLED = {
  "integrations.external": "none",
  "notifications.outbound": "email_only",
  "privacy.class": "basic_contact_data",
  "uploads.policy": "no_uploads",
  "delivery.platforms": "phone_browser",
};

function replaceQuestion(
  bundle: WaveBundle,
  id: string,
  patch: (question: CatalogQuestion) => CatalogQuestion,
): WaveBundle {
  return {
    questions: bundle.questions.map((question) => (question.id === id ? patch(question) : question)),
    elaborations: bundle.elaborations,
  };
}

describe("corpus-wave1", () => {
  const bundle = loadWave1Bundle();

  it("loads 28 questions and at least 45 elaborations", () => {
    expect(bundle.questions.filter((question) => question.packId === "payments")).toHaveLength(8);
    expect(bundle.questions.filter((question) => question.packId === "notifications")).toHaveLength(6);
    expect(bundle.questions.filter((question) => question.packId === "ai-llm")).toHaveLength(6);
    expect(bundle.questions.filter((question) => question.packId === "privacy-scale-obs")).toHaveLength(8);
    expect(bundle.questions).toHaveLength(28);
    expect(bundle.elaborations.length).toBeGreaterThanOrEqual(45);
    const labels = bundle.questions.flatMap((question) => question.options.map((option) => option.label));
    expect(labels).toEqual(
      expect.arrayContaining([
        "Stripe Subscriptions",
        "Stripe Checkout",
        "Client redirect marks order paid without webhooks",
        "Transactional Email via Resend/SMTP",
        "RAG over user PDFs",
        "AI chat over uploaded company PDFs",
        "Soft-delete with 30-day purge",
        "Hard delete user on GDPR request",
        "Immutable audit log storing user email in plain text",
        "Anonymized actor-ID audit trail",
      ]),
    );
  });

  it("passes CorpusQualityValidator with closed tags, examples, and acyclic prerequisites", () => {
    expect(TOUCHES_TAGS).toHaveLength(28);
    new CorpusQualityValidator().validate(bundle);
    for (const question of bundle.questions) {
      expect(question.positive_examples.length).toBeGreaterThanOrEqual(5);
      expect(question.negative_examples.length).toBeGreaterThanOrEqual(2);
      expect(question.positive_examples.some((example) => example.style === "spoken_dictation")).toBe(true);
      expect(question.touches.every((tag) => (TOUCHES_TAGS as readonly string[]).includes(tag))).toBe(true);
    }
    const elaborated = new Set(bundle.elaborations.map((item) => `${item.question}:${item.option}`));
    for (const question of bundle.questions) {
      for (const option of question.options) {
        expect(elaborated.has(`${question.id}:${option.id}`)).toBe(true);
      }
    }
  });

  it("keeps irreversible billing, refund, GDPR, and AI egress questions must-ask", () => {
    const must = new Map(bundle.questions.map((question) => [question.id, question]));
    for (const id of ["Q-PAY-03", "Q-PAY-05", "Q-PAY-07", "Q-PAY-08", "Q-AI-04", "Q-AI-05", "Q-PSO-01", "Q-PSO-02"]) {
      const question = must.get(id);
      expect(question?.must_ask).toBe(true);
      expect(question?.reversibility).toBe("irreversible");
      expect(question?.stage_applicability.prototype).toBe(true);
    }
  });

  it("passes StageCoherenceSelfTest for Prototype, MVP, and Production across 72 questions", () => {
    const m2 = m2StagePort();
    expect(m2.questions).toHaveLength(44);
    expect(M2_QUESTION_IDS).toHaveLength(44);
    const m2Only = new StageCoherenceSelfTest(m2).run();
    expect(m2Only.ok).toBe(true);
    const combined = combinedStageCatalog(bundle);
    expect(combined.questions).toHaveLength(72);
    const waveIds = new Set(bundle.questions.map((question) => question.id));
    expect([...waveIds].some((id) => M2_QUESTION_IDS.includes(id))).toBe(false);
    const report = new StageCoherenceSelfTest(combined).run();
    expect(report.ok).toBe(true);
    expect(report.presets).toHaveLength(3);
    for (const preset of report.presets) {
      expect(preset.conflicts).toEqual([]);
      expect(preset.unsatisfiedRequires).toEqual([]);
      expect(preset.numericConflicts).toEqual([]);
    }
    for (const question of m2.questions) {
      const found = combined.questions.find((item) => item.id === question.id);
      expect(found?.recommend).toEqual(question.recommend);
      expect(found?.options.map((item) => item.id)).toEqual(question.options.map((item) => item.id));
    }
  });

  it("fails coherence when Stripe Checkout is paired with a client redirect", () => {
    const clashing: StageCatalog = {
      source: "clash",
      questions: combinedStageCatalog(bundle).questions.map((question) =>
        question.id === "Q-PAY-03"
          ? {
              ...question,
              recommend: {
                prototype: "client_redirect_marks_paid",
                mvp: "client_redirect_marks_paid",
                production: "client_redirect_marks_paid",
              },
            }
          : question,
      ),
    };
    const report = new StageCoherenceSelfTest(clashing).run();
    expect(report.ok).toBe(false);
    expect(report.presets.some((preset) => preset.conflicts.length > 0)).toBe(true);
  });

  it("keeps the kitchen app and an expense CLI free of payments and AI questions", () => {
    expect(questionsForPrompt(bundle, KITCHEN_SETTLED, KITCHEN)).toEqual([]);
    const expense = questionsForPrompt(
      bundle,
      {
        "integrations.external": "none",
        "uploads.policy": "images_and_docs",
        "privacy.class": "basic_contact_data",
      },
      EXPENSE_CLI,
    );
    expect(expense.filter((question) => question.packId === "payments" || question.packId === "ai-llm")).toEqual([]);
    expect(deriveWave1Flags({ "integrations.external": "one_named_service" }, "Add a maps widget")).not.toHaveProperty(
      "billing.activation",
    );
  });

  it("unlocks only the payments pack for a mid-project Stripe Pro tier", () => {
    const before = activeQuestions(bundle, {});
    const after = questionsForPrompt(bundle, { "integrations.external": "one_named_service" }, STRIPE);
    expect(after.map((question) => question.packId)).toEqual(Array.from({ length: 8 }, () => "payments"));
    expect(new DenominatorDeltaExplainer().explain(before, after)).toBe("+8 Payments questions unlocked");
    const table = activationTable(bundle).find((row) => row.packId === "payments");
    expect(table).toMatchObject({ criterion: "billing.activation", equals: "active", questionCount: 8 });
  });

  it("activates payments plus notifications for paid SaaS, and AI plus privacy for RAG", () => {
    const saas = questionsForPrompt(bundle, {}, PAID_SAAS);
    expect(saas.filter((question) => question.packId === "payments")).toHaveLength(8);
    expect(saas.filter((question) => question.packId === "notifications")).toHaveLength(6);
    expect(saas.filter((question) => question.packId === "ai-llm" || question.packId === "privacy-scale-obs")).toEqual([]);
    const rag = questionsForPrompt(bundle, {}, RAG);
    expect(rag.filter((question) => question.packId === "ai-llm")).toHaveLength(6);
    expect(rag.filter((question) => question.packId === "privacy-scale-obs")).toHaveLength(8);
    expect(rag.filter((question) => question.packId === "payments")).toEqual([]);
  });

  it("still asks AI egress and token limits in Prototype", () => {
    const active = questionsForPrompt(bundle, {}, RAG).filter(
      (question) => question.stage_applicability.prototype && question.must_ask,
    );
    const ids = active.map((question) => question.id);
    expect(ids).toContain("Q-AI-04");
    expect(ids).toContain("Q-AI-05");
    const chat = bundle.questions
      .find((question) => question.id === "Q-AI-01")
      ?.options.find((option) => option.label === "AI chat over uploaded company PDFs");
    expect(chat?.id).toBe("ai_chat_over_pdfs");
  });

  it("warns when Stripe Checkout is combined with a client redirect", () => {
    const warnings = layer1Warnings(bundle.elaborations, {
      "Q-PAY-02": "stripe_checkout",
      "Q-PAY-03": "client_redirect_marks_paid",
    });
    const text = warnings.map((item) => item.warning).join(" ");
    expect(text).toContain("browser-close / spoofed-redirect revenue loss");
    expect(text).toContain("server-side signed webhook fulfillment");
    const checkout = bundle.questions
      .find((question) => question.id === "Q-PAY-02")
      ?.options.find((option) => option.id === "stripe_checkout");
    expect(checkout?.consequences).toContain("browser-close / spoofed-redirect revenue loss");
    expect(layer1Warnings(bundle.elaborations, {
      "Q-PAY-02": "stripe_checkout",
      "Q-PAY-03": "signed_webhook_fulfillment",
    })).toEqual([]);
  });

  it("catches hard delete plus a plain-text email audit and offers an actor id", () => {
    const warnings = layer1Warnings(bundle.elaborations, {
      "Q-PSO-01": "hard_delete",
      "Q-PSO-02": "immutable_plain_email",
    });
    const text = warnings.map((item) => item.warning).join(" ");
    expect(text).toContain("anonymized actor-ID audit trail");
    expect(warnings.some((item) => item.offer === "Q-PSO-02:anonymized_actor_id")).toBe(true);
    expect(layer1Warnings(bundle.elaborations, {
      "Q-PSO-01": "soft_delete_30_day",
      "Q-PSO-02": "anonymized_actor_id",
    })).toEqual([]);
  });

  it("requires a duplicate-event idempotency oracle on every payment, notification, and AI elaboration", () => {
    assertDomainOracles(bundle);
    const stripped: WaveBundle = {
      questions: bundle.questions,
      elaborations: bundle.elaborations.map((item) =>
        item.option === "signed_webhook_fulfillment" ? { ...item, oracle_hints: ["No replay rule is stated."] } : item,
      ),
    };
    expect(() => assertDomainOracles(stripped)).toThrow(/duplicate-event idempotency oracle/);
  });

  it("rejects a tag outside the closed 28, short examples, cycles, dangling refs, asymmetric conflicts, and a must-ask miss", () => {
    const validator = new CorpusQualityValidator();
    expect(() =>
      validator.validate(replaceQuestion(bundle, "Q-PAY-01", (question) => ({ ...question, touches: ["payments_stripe"] }))),
    ).toThrow(UnrecognizedTouchesTagError);
    expect(() =>
      validator.validate(
        replaceQuestion(bundle, "Q-PAY-01", (question) => ({
          ...question,
          positive_examples: question.positive_examples.slice(0, 4),
        })),
      ),
    ).toThrow(InsufficientExamplesError);
    expect(() =>
      validator.validate(replaceQuestion(bundle, "Q-PAY-01", (question) => ({ ...question, requires: ["Q-PAY-02"] }))),
    ).toThrow(PrerequisiteCycleError);
    expect(() =>
      validator.validate(replaceQuestion(bundle, "Q-PAY-08", (question) => ({ ...question, requires: ["Q-NOPE-01"] }))),
    ).toThrow(/requires missing Q-NOPE-01/);
    expect(() =>
      validator.validate(
        replaceQuestion(bundle, "Q-PAY-01", (question) => ({ ...question, conflicts_with: ["Q-PAY-02"] })),
      ),
    ).toThrow(AsymmetricConflictError);
    expect(() =>
      validator.validate(
        replaceQuestion(bundle, "Q-PAY-03", (question) => ({ ...question, must_ask: false })),
      ),
    ).toThrow(MustAskPolicyFloorError);
  });
});
