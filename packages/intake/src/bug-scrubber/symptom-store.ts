import { randomUUID } from "node:crypto";
import { bindKnowledgeGraph, type KnowledgeGraphRepo, type ProjectStateDb } from "@ef-harness/db";
import type { CasBlobStorePort } from "./cas-port.js";
import { PacketSecurityRedactor } from "./packet-security-redactor.js";
import { SafetyScanner } from "./safety-scanner.js";
import { parseSymptomCard } from "./symptom-card.js";
import { ResidualSecretError, type RouteDecision, type SymptomCard } from "./types.js";

export interface StoredSymptom {
  readonly id: string;
  readonly casHash: string;
  readonly route: RouteDecision["route"];
}

/**
 * Persists only scrubbed symptom cards in `ProjectStateDb` and `CasBlobStore`.
 * A second `SecretRedactor` pass plus `SafetyScanner` run before either write.
 */
export class SymptomCardStore {
  private readonly redactor: PacketSecurityRedactor;
  private readonly scanner: SafetyScanner;
  private readonly graph: KnowledgeGraphRepo | null;

  constructor(
    private readonly cas: CasBlobStorePort,
    private readonly state?: ProjectStateDb,
  ) {
    this.redactor = new PacketSecurityRedactor();
    this.scanner = new SafetyScanner();
    this.graph = state ? bindKnowledgeGraph(state) : null;
  }

  async save(input: {
    readonly card: SymptomCard;
    readonly badge: string;
    readonly route: RouteDecision;
    readonly scrubbedHarText?: string;
    readonly scrubbedLogText?: string;
  }): Promise<StoredSymptom> {
    const card = cardWithoutId(input.card);
    const payload = JSON.stringify({
      card,
      badge: input.badge,
      route: input.route.route,
      har: input.scrubbedHarText ?? null,
      log: input.scrubbedLogText ?? null,
    });
    this.assertClean(payload);
    this.assertClean(card.title);
    this.assertClean(input.badge);
    const stored = await this.cas.putBlob(new TextEncoder().encode(payload), {
      holderKind: "symptom-card",
      holderId: input.route.task,
    });
    const id = `BUG-${randomUUID()}`;
    if (this.graph && this.state) {
      this.graph.commitChangeSet({
        origin: "intake",
        author: "bug-intake",
        summary: `Symptom ${card.title}`,
        nodes: [
          {
            op: "create",
            id,
            kind: "source",
            title: card.title,
            text: card.observedBehavior,
            fields: {
              recordType: "symptom_card",
              card,
              badge: input.badge,
              route: input.route.route,
              casSha256: stored.hash,
              basis: "observed",
            },
            status: "active",
            ownerRole: "intake",
          },
        ],
      });
      this.writeArtifact(id, stored.hash, payload.length);
    }
    return { id, casHash: stored.hash, route: input.route.route };
  }

  getSymptomCard(id: string): SymptomCard | null {
    if (!this.graph) return null;
    const node = this.graph.getNode(id);
    if (!node || node.status !== "active" || !isRecord(node.fields)) return null;
    if (node.fields.recordType !== "symptom_card") return null;
    const card = parseSymptomCard(node.fields.card);
    if (!card) return null;
    return { ...card, id };
  }

  private writeArtifact(id: string, hash: string, bytes: number): void {
    const state = this.state;
    if (!state) return;
    const artifactId = `ART-${id}`;
    const createdAt = Date.now();
    state.writer.transaction(() => {
      state.writer.run(
        "INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at) VALUES (?, ?, 'log', ?, 'application/json', 'diagnostic', ?)",
        [artifactId, hash, bytes, createdAt],
      );
      state.writer.run(
        "INSERT INTO artifact_refs(artifact, owner_kind, owner_id) VALUES (?, 'symptom_card', ?)",
        [artifactId, id],
      );
    });
  }

  private assertClean(text: string): void {
    if (this.redactor.scan(text).length > 0 || this.scanner.scan(text).length > 0) {
      throw new ResidualSecretError();
    }
  }
}

function cardWithoutId(card: SymptomCard): SymptomCard {
  if (card.id === undefined) return card;
  const { id, ...rest } = card;
  if (id.length === 0) return rest;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
