import { CodeIndexDb } from "@ef-harness/db";
import { ModuleCardWriterV1Schema } from "@ef-harness/shared-contracts";
import { getSharedSecretRedactor, StreamingRedactor } from "@ef-harness/shared-observability";
import type { ModuleCardStorePort } from "./ports.js";
import type { ModuleCardCacheKey, ModuleCardWriterV1Output, StoredModuleCard } from "./types.js";

const STREAM_OVERLAP = 64;

export class SqliteModuleCardStore implements ModuleCardStorePort {
  constructor(private readonly dbPath: string) {}

  get(key: ModuleCardCacheKey): StoredModuleCard | null {
    return this.withDb((db) => {
      const row = db.writer.get(
        `SELECT card_json, created_at
           FROM module_cards
          WHERE file_path = :file_path
            AND file_content_sha256 = :file_content_sha256
            AND prompt_version = :prompt_version`,
        {
          file_path: key.filePath,
          file_content_sha256: key.fileContentSha256,
          prompt_version: key.promptVersion,
        },
      ) as { card_json?: string; created_at?: number } | undefined;
      if (!row?.card_json || typeof row.created_at !== "number") return null;
      const card = JSON.parse(row.card_json) as ModuleCardWriterV1Output;
      return { key, card, createdAtMs: row.created_at };
    });
  }

  put(card: StoredModuleCard): void {
    const payload = redactCard(card);
    this.withDb((db) => {
      db.writer.run(
        `INSERT INTO module_cards(file_path, file_content_sha256, prompt_version, card_json, created_at)
         VALUES (:file_path, :file_content_sha256, :prompt_version, :card_json, :created_at)
         ON CONFLICT(file_path, file_content_sha256, prompt_version)
         DO UPDATE SET card_json = excluded.card_json, created_at = excluded.created_at`,
        {
          file_path: card.key.filePath,
          file_content_sha256: card.key.fileContentSha256,
          prompt_version: card.key.promptVersion,
          card_json: payload,
          created_at: card.createdAtMs,
        },
      );
    });
  }

  deleteForPath(filePath: string): void {
    this.withDb((db) => {
      db.writer.run("DELETE FROM module_cards WHERE file_path = :file_path", { file_path: filePath });
    });
  }

  private withDb<T>(work: (db: CodeIndexDb) => T): T {
    const db = CodeIndexDb.open({ filePath: this.dbPath });
    try {
      return work(db);
    } finally {
      db.close();
    }
  }
}

function redactCard(card: StoredModuleCard): string {
  const normalized = normalizeCard(card);
  const parsed = ModuleCardWriterV1Schema.parse(normalized);
  const stream = new StreamingRedactor(getSharedSecretRedactor(), STREAM_OVERLAP);
  return `${stream.push(JSON.stringify(parsed))}${stream.flush()}`;
}

function normalizeCard(card: StoredModuleCard): {
  module: string;
  purpose: string;
  key_exports: Array<{ name: string; signature: string; file: string; line: number }>;
  reads: string[];
  writes: string[];
  side_effects: string[];
  tests: string[];
  confidence: ModuleCardWriterV1Output["confidence"];
} {
  return {
    module: card.card.module,
    purpose: card.card.purpose,
    key_exports: card.card.key_exports.map((entry) => ({
      name: entry.name,
      signature: entry.signature ?? entry.name,
      file: card.key.filePath,
      line: 1,
    })),
    reads: [...card.card.reads],
    writes: [...card.card.writes],
    side_effects: [...card.card.side_effects],
    tests: [...card.card.tests],
    confidence: card.card.confidence,
  };
}
