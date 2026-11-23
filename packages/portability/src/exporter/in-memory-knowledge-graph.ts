import type {
  ExportEntity,
  ExportState,
  HistoryRecord,
  KnowledgeGraphRepoPort,
  KnowledgeGraphSnapshot,
  LeaseSnapshot,
} from "./types.js";
import { stableSortedJson } from "./canonical-hash.js";
import { createCanonicalHashPort } from "./canonical-hash.js";

export class InMemoryKnowledgeGraphRepo implements KnowledgeGraphRepoPort {
  private entities = new Map<string, ExportEntity>();
  private historyRecords: HistoryRecord[] = [];
  private lease: LeaseSnapshot;
  private exportState: ExportState = {
    lastExportedRevisionByEntity: {},
    lastCanonicalGraphSha256: null,
    lastHarnessStateCommit: null,
    lastBlobShasByPath: {},
  };

  constructor(
    readonly projectId: string,
    readonly deviceId: string,
    readonly writerEpoch: number,
    lease?: Partial<LeaseSnapshot>,
  ) {
    this.lease = {
      deviceId,
      holder: "TEST-HOST",
      epoch: writerEpoch,
      heartbeat: new Date().toISOString(),
      revision: 0,
      ...lease,
    };
  }

  upsertEntity(entity: ExportEntity): void {
    this.entities.set(`${entity.kind}:${entity.id}`, entity);
  }

  addHistory(record: HistoryRecord): void {
    this.historyRecords.push(record);
  }

  loadExportSnapshot(): KnowledgeGraphSnapshot {
    const entities = [...this.entities.values()].sort((a, b) => {
      const byKind = a.kind.localeCompare(b.kind);
      if (byKind !== 0) return byKind;
      return a.id.localeCompare(b.id);
    });
    return {
      projectId: this.projectId,
      deviceId: this.deviceId,
      writerEpoch: this.writerEpoch,
      entities,
      history: [...this.historyRecords],
      lease: { ...this.lease },
      canonicalGraphSha256: this.computeGraphHash(entities),
    };
  }

  readExportState(): ExportState {
    return {
      lastExportedRevisionByEntity: { ...this.exportState.lastExportedRevisionByEntity },
      lastCanonicalGraphSha256: this.exportState.lastCanonicalGraphSha256,
      lastHarnessStateCommit: this.exportState.lastHarnessStateCommit,
      lastBlobShasByPath: { ...this.exportState.lastBlobShasByPath },
    };
  }

  writeExportState(state: ExportState): void {
    this.exportState = {
      lastExportedRevisionByEntity: { ...state.lastExportedRevisionByEntity },
      lastCanonicalGraphSha256: state.lastCanonicalGraphSha256,
      lastHarnessStateCommit: state.lastHarnessStateCommit,
      lastBlobShasByPath: { ...state.lastBlobShasByPath },
    };
  }

  private computeGraphHash(entities: readonly ExportEntity[]): string {
    const body = stableSortedJson(
      entities.map((e) => ({ id: e.id, kind: e.kind, revision: e.revision, fields: e.fields, deleted: e.deleted })),
    );
    return createCanonicalHashPort().sha256Hex(new TextEncoder().encode(body));
  }
}