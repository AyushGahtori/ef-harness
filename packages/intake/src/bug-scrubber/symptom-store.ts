import { randomUUID } from "node:crypto";
import { MemoryCasBlobStore, type CasBlobStorePort } from "./cas-port.js";
import { PacketSecurityRedactor } from "./packet-security-redactor.js";
import { SafetyScanner } from "./safety-scanner.js";
import { ResidualSecretError, type RouteDecision, type SymptomCard } from "./types.js";

export interface StateStatement {
  run(...values: readonly (string | number | null)[]): unknown;
  all(...values: readonly (string | number | null)[]): unknown[];
}

export interface StateDatabase {
  exec(sql: string): void;
  prepare(sql: string): StateStatement;
}

export interface StoredSymptom {
  readonly id: string;
  readonly casHash: string;
  readonly route: RouteDecision["route"];
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS symptom_cards (
  id TEXT PRIMARY KEY,
  cas_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  badge TEXT NOT NULL,
  route TEXT NOT NULL
)`;

/**
 * Persists only scrubbed symptom cards. A second PacketSecurityRedactor pass
 * plus the independent SafetyScanner run before any CAS or state.db write.
 */
export class SymptomCardStore {
  private readonly redactor: PacketSecurityRedactor;
  private readonly scanner: SafetyScanner;

  constructor(
    private readonly cas: CasBlobStorePort = new MemoryCasBlobStore(),
    private readonly stateDb?: StateDatabase,
  ) {
    this.redactor = new PacketSecurityRedactor();
    this.scanner = new SafetyScanner();
  }

  async save(input: {
    readonly card: SymptomCard;
    readonly badge: string;
    readonly route: RouteDecision;
    readonly scrubbedHarText?: string;
    readonly scrubbedLogText?: string;
  }): Promise<StoredSymptom> {
    const payload = JSON.stringify({
      card: input.card,
      badge: input.badge,
      route: input.route.route,
      har: input.scrubbedHarText ?? null,
      log: input.scrubbedLogText ?? null,
    });
    this.assertClean(payload);
    this.assertClean(input.card.title);
    this.assertClean(input.badge);
    const stored = await this.cas.putBlob(new TextEncoder().encode(payload), {
      holderKind: "symptom-card",
      holderId: input.route.task,
    });
    const id = randomUUID();
    if (this.stateDb) {
      this.stateDb.exec(CREATE_TABLE);
      this.stateDb
        .prepare(
          "INSERT INTO symptom_cards (id, cas_hash, title, severity, badge, route) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, stored.hash, input.card.title, input.card.severity, input.badge, input.route.route);
    }
    return { id, casHash: stored.hash, route: input.route.route };
  }

  private assertClean(text: string): void {
    if (this.redactor.scan(text).length > 0 || this.scanner.scan(text).length > 0) {
      throw new ResidualSecretError();
    }
  }
}
