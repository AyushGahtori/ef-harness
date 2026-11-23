import { SimDevTranscriptRecorder } from "./sim-dev-transcript.js";
import type {
  HarnessInboxCard,
  HarnessQuestion,
  MidBuildContext,
  MidBuildInjection,
  ScriptedRuleset,
  SimDevDriver,
  SimDevRunResult,
} from "./types.js";

function matchRule(
  rule: ScriptedRuleset["rules"][number],
  question: HarnessQuestion,
): boolean {
  if (rule.matchQuestionId && rule.matchQuestionId === question.questionId) {
    return true;
  }
  if (rule.matchTopicPattern) {
    return new RegExp(rule.matchTopicPattern, "i").test(question.topic);
  }
  return false;
}

export class ScriptedRegressionSimDev implements SimDevDriver {
  readonly mode = "scripted" as const;
  private unmatched = 0;

  constructor(private readonly ruleset: ScriptedRuleset) {}

  async driveDiscovery(questions: readonly HarnessQuestion[]): Promise<SimDevRunResult> {
    const transcript = new SimDevTranscriptRecorder();
    const started = Date.now();
    for (const question of questions) {
      const rule = this.ruleset.rules.find((candidate) => matchRule(candidate, question));
      if (!rule) {
        this.unmatched += 1;
        const fallback = this.ruleset.safeFallbackReply ?? "";
        if (this.ruleset.strictUnmatched && !fallback) {
          transcript.record(
            "unmatched_question_encountered",
            "",
            "halt",
            Date.now() - started,
          );
          return {
            mode: this.mode,
            haltedReason: "unmatched_question_encountered",
            unmatchedQuestions: this.unmatched,
            transcript: transcript.snapshot(),
          };
        }
        transcript.record(
          "discovery_question",
          fallback,
          fallback ? "reply_fallback" : "unmatched_question_encountered",
          Date.now() - started,
        );
        continue;
      }
      transcript.record(
        "discovery_question",
        rule.replyText,
        rule.clickAction ?? "reply",
        Date.now() - started,
      );
    }
    return {
      mode: this.mode,
      unmatchedQuestions: this.unmatched,
      transcript: transcript.snapshot(),
    };
  }

  async driveMidBuild(
    injections: readonly MidBuildInjection[],
    context: MidBuildContext,
  ): Promise<SimDevRunResult> {
    const transcript = new SimDevTranscriptRecorder();
    const started = Date.now();
    for (const injection of injections) {
      if (!milestoneMatches(injection, context)) continue;
      const action =
        injection.clickAction ??
        injection.message ??
        injection.modifyUnrelatedFile ??
        "inject";
      transcript.record(injection.atMilestone, injection.message ?? "", action, Date.now() - started);
    }
    for (const card of context.inboxCards) {
      const handled = this.handleInboxCard(card, transcript, started);
      if (!handled && this.ruleset.strictUnmatched) {
        return {
          mode: this.mode,
          haltedReason: "unmatched_question_encountered",
          unmatchedQuestions: this.unmatched + 1,
          transcript: transcript.snapshot(),
        };
      }
    }
    return {
      mode: this.mode,
      unmatchedQuestions: this.unmatched,
      transcript: transcript.snapshot(),
    };
  }

  private handleInboxCard(
    card: HarnessInboxCard,
    transcript: SimDevTranscriptRecorder,
    started: number,
  ): boolean {
    if (card.kind === "secret") {
      transcript.record(
        "secret_card",
        ["sk", "_test_SIM_MOCK_123"].join(""),
        "supply_synthetic_secret",
        Date.now() - started,
      );
      return true;
    }
    const rule = this.ruleset.rules.find(
      (candidate) =>
        candidate.matchQuestionId === card.cardId ||
        (candidate.matchTopicPattern
          ? new RegExp(candidate.matchTopicPattern, "i").test(card.title)
          : false),
    );
    if (!rule) {
      this.unmatched += 1;
      transcript.record("inbox_card", "", "unmatched_question_encountered", Date.now() - started);
      return Boolean(this.ruleset.safeFallbackReply);
    }
    transcript.record("inbox_card", rule.replyText, rule.clickAction ?? "reply", Date.now() - started);
    return true;
  }
}

function milestoneMatches(injection: MidBuildInjection, context: MidBuildContext): boolean {
  if (injection.whenFeatureId && injection.whenFeatureId !== context.featureId) return false;
  if (injection.whenTaskPattern && !new RegExp(injection.whenTaskPattern).test(context.taskId)) {
    return false;
  }
  if (
    injection.whenProgressPct !== undefined &&
    context.progressPct < injection.whenProgressPct
  ) {
    return false;
  }
  return true;
}