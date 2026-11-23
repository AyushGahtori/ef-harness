import { AnonymizationScrubber } from "./anonymization-scrubber.js";
import { SimDevTranscriptRecorder } from "./sim-dev-transcript.js";
import type {
  AnonymizedRecordedSession,
  MidBuildContext,
  MidBuildInjection,
  RecordedSessionFixture,
  RecordedTurn,
  SimDevDriver,
  SimDevRunResult,
} from "./types.js";

export class AnonymizedSessionReplayer implements SimDevDriver {
  readonly mode = "recorded" as const;
  private readonly scrubber = new AnonymizationScrubber();
  private anonymized: AnonymizedRecordedSession | undefined;

  constructor(private readonly fixture: RecordedSessionFixture) {}

  async exportRecordedSession(): Promise<AnonymizedRecordedSession> {
    const turns = this.fixture.turns.map((turn) => {
      const scrubbedMessage = turn.userMessage
        ? this.scrubber.scrub(turn.userMessage).text
        : undefined;
      if (scrubbedMessage === undefined) {
        return { seq: turn.seq, uiActions: [...turn.uiActions] };
      }
      return {
        seq: turn.seq,
        uiActions: [...turn.uiActions],
        userMessage: scrubbedMessage,
      } satisfies RecordedTurn;
    });
    const merged = turns.map((t) => t.userMessage ?? "").join("\n");
    this.scrubber.assertClean(merged);
    const session: AnonymizedRecordedSession = {
      sessionId: this.fixture.sessionId,
      turns,
      scrubPasses: 2,
    };
    this.anonymized = session;
    return session;
  }

  async driveDiscovery(): Promise<SimDevRunResult> {
    const session = this.anonymized ?? (await this.exportRecordedSession());
    const transcript = new SimDevTranscriptRecorder();
    const started = Date.now();
    for (const turn of session.turns) {
      if (turn.userMessage) {
        transcript.record(
          `recorded_turn_${turn.seq}`,
          turn.userMessage,
          "replay_message",
          Date.now() - started,
        );
      }
      for (const action of turn.uiActions) {
        transcript.record(
          `recorded_turn_${turn.seq}`,
          action.value ?? "",
          `${action.kind}:${action.target}`,
          Date.now() - started,
        );
      }
    }
    return {
      mode: this.mode,
      unmatchedQuestions: 0,
      transcript: transcript.snapshot(),
    };
  }

  async driveMidBuild(
    injections: readonly MidBuildInjection[],
    context: MidBuildContext,
  ): Promise<SimDevRunResult> {
    void injections;
    void context;
    return this.driveDiscovery();
  }
}