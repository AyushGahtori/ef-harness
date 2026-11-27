import type { CasBlobStore as DbCasBlobStore, ProjectStateDb } from "@ef-harness/db";
import { DbSymptomCas } from "./db-cas.js";
import { FakeModelAdapter } from "./fake-model.js";
import { SymptomCardStore } from "./symptom-store.js";
import { ToolLessIssueTriager, type ToolLessModel, type TriageInput } from "./triager.js";
import type { SymptomCard } from "./types.js";

/**
 * Scrubs a bug report, then stores the symptom card in `ProjectStateDb`.
 * `getSymptomCard` reads that row for the mystery-bug investigation pipeline.
 */
export class BugIntakePipeline {
  private readonly triager: ToolLessIssueTriager;
  private readonly store: SymptomCardStore;

  constructor(options: {
    readonly state: ProjectStateDb;
    readonly cas: DbCasBlobStore;
    readonly holderId: string;
    readonly model?: ToolLessModel;
  }) {
    const model = options.model ?? new FakeModelAdapter([]);
    this.triager = new ToolLessIssueTriager(model);
    this.store = new SymptomCardStore(new DbSymptomCas(options.cas, options.holderId), options.state);
  }

  async ingestBugReport(input: TriageInput): Promise<SymptomCard> {
    const result = await this.triager.triage(input);
    const saved = await this.store.save({
      card: result.card,
      badge: result.badge,
      route: result.route,
      scrubbedLogText: result.scrubbedReport,
      ...(result.scrubbedHar ? { scrubbedHarText: JSON.stringify(result.scrubbedHar) } : {}),
    });
    return this.store.getSymptomCard(saved.id) ?? { ...result.card, id: saved.id };
  }

  getSymptomCard(id: string): SymptomCard | null {
    return this.store.getSymptomCard(id);
  }
}
