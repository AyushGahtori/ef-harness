import { DeterministicFakeModelAdapter } from "./fake-model-adapter.js";
import {
  PersonaIsolationVault,
  assertHarnessPromptClean,
} from "./persona-isolation-guard.js";
import { SimDevTranscriptRecorder } from "./sim-dev-transcript.js";
import type {
  FakeModelAdapter,
  HarnessQuestion,
  HiddenSpecPersonaConfig,
  MidBuildContext,
  MidBuildInjection,
  SimDevDriver,
  SimDevRunResult,
} from "./types.js";

const SYNTHETIC_SECRET = ["sk", "_test_SIM_MOCK_123"].join("");

export class HiddenSpecPersonaSimDev implements SimDevDriver {
  readonly mode = "persona" as const;
  private readonly vault: PersonaIsolationVault;
  private readonly maxTurns: number;
  private readonly repetitionCeiling: number;
  private readonly model: FakeModelAdapter;

  constructor(
    private readonly config: HiddenSpecPersonaConfig,
    model?: FakeModelAdapter,
  ) {
    this.vault = new PersonaIsolationVault(config.hiddenSpec);
    this.maxTurns = config.maxTurns ?? 25;
    this.repetitionCeiling = config.repetitionCeiling ?? 3;
    this.model = model ?? new DeterministicFakeModelAdapter([
      { match: { includes: config.persona }, response: "We need invoicing and role-based access." },
      { response: "Let me think." },
    ]);
  }

  async driveDiscovery(questions: readonly HarnessQuestion[]): Promise<SimDevRunResult> {
    const transcript = new SimDevTranscriptRecorder();
    const started = Date.now();
    let repetitions = 0;
    let lastReply = "";

    for (let index = 0; index < questions.length && index < this.maxTurns; index += 1) {
      const question = questions[index];
      if (!question) break;

      const harnessVisiblePrompt = question.promptText;
      assertHarnessPromptClean(harnessVisiblePrompt, this.config.hiddenSpec);
      const personaPrompt = this.buildPersonaPrompt(question.promptText);

      const result = await this.model.complete({
        modelId: "persona-sim",
        systemPrompt: personaPrompt,
        messagesJson: JSON.stringify([{ role: "user", content: question.promptText }]),
        toolsSchemaJson: "{}",
        temperature: 0,
        seed: index,
        responseFormatSchema: "{}",
      });

      if (result.content === lastReply) {
        repetitions += 1;
      } else {
        repetitions = 0;
      }
      lastReply = result.content;

      if (repetitions >= this.repetitionCeiling) {
        transcript.record(
          "discovery_question",
          result.content,
          "repetition_halt",
          Date.now() - started,
          result.inputTokens + result.outputTokens,
        );
        return {
          mode: this.mode,
          haltedReason: "persona_repetition_ceiling",
          unmatchedQuestions: 0,
          transcript: transcript.snapshot(),
        };
      }

      transcript.record(
        "discovery_question",
        result.content,
        "persona_reply",
        Date.now() - started,
        result.inputTokens + result.outputTokens,
      );
    }

    if (questions.length > this.maxTurns) {
      return {
        mode: this.mode,
        haltedReason: "persona_turn_ceiling",
        unmatchedQuestions: 0,
        transcript: transcript.snapshot(),
      };
    }

    return {
      mode: this.mode,
      unmatchedQuestions: 0,
      transcript: transcript.snapshot(),
    };
  }

  async driveMidBuild(
    _injections: readonly MidBuildInjection[],
    context: MidBuildContext,
  ): Promise<SimDevRunResult> {
    const transcript = new SimDevTranscriptRecorder();
    const started = Date.now();
    for (const card of context.inboxCards) {
      if (card.kind === "secret") {
        transcript.record("secret_card", SYNTHETIC_SECRET, "supply_synthetic_secret", Date.now() - started);
        continue;
      }
      transcript.record("inbox_card", "ok", "persona_ack", Date.now() - started);
    }
    return { mode: this.mode, unmatchedQuestions: 0, transcript: transcript.snapshot() };
  }

  isolationVault(): PersonaIsolationVault {
    return this.vault;
  }

  private buildPersonaPrompt(question: string): string {
    return [
      `persona=${this.config.persona}`,
      `hidden_spec=${this.vault.readForPersonaOnly()}`,
      `answer_only_what_is_asked=true`,
      `question=${question}`,
    ].join("\n");
  }
}