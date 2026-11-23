import type { ExportEntity, RehydratedGraph } from "./types.js";
import { computeCanonicalGraphSha256 } from "./canonical-graph.js";
import { HarnessStateReader } from "./harness-state-reader.js";
import { RehydrationError } from "./errors.js";
import { rebuildStateDatabase, type RehydratedDatabase } from "./rehydration-schema.js";
import { upcastManifest } from "./schema-upcaster.js";
import { AgeSealedChecksDecryptor } from "./age-sealed-checks-decryptor.js";

export interface OrphanBranchRehydrationResult {
  readonly graph: RehydratedGraph;
  readonly database: RehydratedDatabase;
  readonly decryptedChecks: Readonly<Record<string, string>>;
  readonly undecryptableCheckPaths: readonly string[];
}

export class OrphanBranchRehydrator {
  constructor(
    private readonly repoPath: string,
    private readonly ageDecryptor: AgeSealedChecksDecryptor = new AgeSealedChecksDecryptor(null),
  ) {}

  async rehydrate(): Promise<OrphanBranchRehydrationResult> {
    const tree = new HarnessStateReader(this.repoPath).readTree();
    const manifest = upcastManifest(tree.manifest);

    const computed = computeCanonicalGraphSha256(tree.entities, tree.history);
    if (computed !== manifest.canonicalGraphSha256) {
      throw new RehydrationError(
        "graph_hash_mismatch",
        `canonicalGraphSha256 mismatch (manifest=${manifest.canonicalGraphSha256}, computed=${computed})`,
      );
    }

    const decryptedChecks: Record<string, string> = {};
    const undecryptableCheckPaths: string[] = [];
    for (const [filePath, content] of Object.entries(tree.sealedChecksByPath)) {
      try {
        decryptedChecks[filePath] = await this.ageDecryptor.decryptFile(content, filePath);
      } catch (error) {
        if (error instanceof RehydrationError && error.code === "sealed_decrypt_failed") {
          undecryptableCheckPaths.push(filePath);
          continue;
        }
        throw error;
      }
    }

    const graph: RehydratedGraph = {
      projectId: manifest.projectId,
      canonicalGraphSha256: manifest.canonicalGraphSha256,
      entities: tree.entities as readonly ExportEntity[],
      history: tree.history,
      writerEpoch: manifest.writerEpoch,
      deviceId: manifest.deviceId,
    };

    const database = rebuildStateDatabase({
      projectId: manifest.projectId,
      writerEpoch: manifest.writerEpoch,
      deviceId: manifest.deviceId,
      canonicalGraphSha256: manifest.canonicalGraphSha256,
      entities: tree.entities,
      history: tree.history,
    });

    return { graph, database, decryptedChecks, undecryptableCheckPaths };
  }
}