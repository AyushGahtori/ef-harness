import { ArtifactHandoffStore } from "./artifact-store.js";
import { HandoffAuditTrail } from "./audit.js";
import { DEFAULT_MAILBOX_TTL } from "./constants.js";
import { HandoffDatabase } from "./database.js";
import { DurableRoleMailbox } from "./mailbox.js";
import { HandoffMcpSurface } from "./mcp-surface.js";
import { OwnerResolutionCoordinator } from "./owner-resolution.js";
import {
  FormatSlicePinPort,
  LocalKnowledgeGraphPort,
  LocalTaskHoldsPort,
  SqliteCasBlobStore,
  type CasBlobStorePort,
  type KnowledgeGraphPort,
  type SlicePinPort,
  type TaskHoldsPort,
} from "./ports.js";
import { ReadResultToolHandler } from "./read-result.js";
import type { MailboxTtlPolicy } from "./types.js";
import { WaitGraphCycleDetector } from "./wait-graph.js";

export interface HandoffRuntimeOptions {
  readonly stateDbPath: string;
  readonly now?: () => number;
  readonly cas?: CasBlobStorePort;
  readonly graph?: KnowledgeGraphPort;
  readonly holds?: TaskHoldsPort;
  readonly slices?: SlicePinPort;
  readonly ttl?: MailboxTtlPolicy;
  readonly needsHumanDecision?: (from: string, to: string) => boolean;
}

export class HandoffRuntime {
  readonly store: ArtifactHandoffStore;
  readonly waitGraph: WaitGraphCycleDetector;
  readonly mailbox: DurableRoleMailbox;
  readonly owners: OwnerResolutionCoordinator;
  readonly readResult: ReadResultToolHandler;
  readonly audit: HandoffAuditTrail;
  readonly surface: HandoffMcpSurface;

  private constructor(
    readonly db: HandoffDatabase,
    readonly cas: CasBlobStorePort,
    readonly holds: TaskHoldsPort,
    readonly slices: SlicePinPort,
    readonly graph: KnowledgeGraphPort,
    readonly now: () => number,
    store: ArtifactHandoffStore,
    waitGraph: WaitGraphCycleDetector,
    mailbox: DurableRoleMailbox,
    owners: OwnerResolutionCoordinator,
    readResult: ReadResultToolHandler,
    audit: HandoffAuditTrail,
    surface: HandoffMcpSurface,
  ) {
    this.store = store;
    this.waitGraph = waitGraph;
    this.mailbox = mailbox;
    this.owners = owners;
    this.readResult = readResult;
    this.audit = audit;
    this.surface = surface;
  }

  static open(options: HandoffRuntimeOptions): HandoffRuntime {
    const now = options.now ?? (() => Date.now());
    const db = HandoffDatabase.open(options.stateDbPath);
    const cas = options.cas ?? new SqliteCasBlobStore(db, now);
    const holds = options.holds ?? new LocalTaskHoldsPort();
    const slices = options.slices ?? new FormatSlicePinPort();
    const graph = options.graph ?? new LocalKnowledgeGraphPort();
    const waitGraph = new WaitGraphCycleDetector(db, now, options.needsHumanDecision ?? (() => false));
    const store = new ArtifactHandoffStore(db, cas, slices, now);
    const mailbox = new DurableRoleMailbox(db, waitGraph, holds, now, options.ttl ?? DEFAULT_MAILBOX_TTL);
    const owners = new OwnerResolutionCoordinator(db, mailbox, now);
    const readResult = new ReadResultToolHandler(db, cas);
    const audit = new HandoffAuditTrail(db);
    const surface = new HandoffMcpSurface(readResult);
    for (const edge of graph.dependsOnEdges()) waitGraph.addDependsOn(edge.from, edge.to);
    owners.seed(graph.owners());
    return new HandoffRuntime(db, cas, holds, slices, graph, now, store, waitGraph, mailbox, owners, readResult, audit, surface);
  }

  close(): void {
    this.db.close();
  }
}
