import { PaperAndParcelFlowVisuals } from "./paper-and-parcel-flow-visuals.js";
import { formatOfficeStatusLine } from "./status-line.js";
import type {
  OfficeCanonicalSnapshot,
  OfficeCastScene,
  SeatedCastMember,
  TierLabel,
} from "./types.js";

export interface WorkerInspectorOpenRequest {
  readonly taskId: string;
  readonly agentId: string;
  readonly completed: boolean;
  readonly tabs: readonly ["Timeline", "Diff"];
}

export interface OfficeInteractionPorts {
  readonly inspector: {
    open(request: WorkerInspectorOpenRequest): void;
  };
  readonly inbox: {
    focusTopActionable(request: { readonly cardId: string | null }): void;
  };
  readonly summaries: {
    openPool2(request: { readonly rigIndex: number | null }): void;
    openMergeQueue(): void;
    openShip(): void;
    openExternalIntake(request: { readonly itemIds: readonly string[] }): void;
  };
}

export type OfficeClickTarget =
  | { readonly kind: "worker"; readonly agentId: string; readonly taskId: string }
  | { readonly kind: "ceo-desk" }
  | { readonly kind: "inbox-tray" }
  | { readonly kind: "qa-test-rig"; readonly rigIndex: number | null }
  | { readonly kind: "merge-bay" }
  | { readonly kind: "shipping-dock" }
  | { readonly kind: "front-desk-parcel" };

export type OfficeHoverTarget =
  | { readonly kind: "worker"; readonly agentId: string }
  | { readonly kind: "desk"; readonly agentId: string };

export interface OfficeHoverTooltip {
  readonly agentId: string;
  readonly tag: string;
  readonly fullTitle: string;
  readonly statusLine: string;
  readonly modelName: string;
  readonly connectionLabel: string;
  readonly connectionColor: string;
  readonly connectionShape: string;
  readonly level: TierLabel;
  readonly elapsedSeconds: number;
  readonly healthLabel: string | null;
}

export type InteractionEffect =
  | {
      readonly type: "open-worker-inspector";
      readonly taskId: string;
      readonly agentId: string;
      readonly completed: boolean;
    }
  | { readonly type: "focus-calm-inbox"; readonly cardId: string | null }
  | { readonly type: "open-pool2-summary"; readonly rigIndex: number | null }
  | { readonly type: "open-merge-queue-summary" }
  | { readonly type: "open-ship-summary" }
  | { readonly type: "open-external-intake"; readonly itemIds: readonly string[] };

export interface OfficeInteractionLog {
  inspectorOpens: WorkerInspectorOpenRequest[];
  inboxFocus: { cardId: string | null }[];
  pool2Opens: number;
  mergeOpens: number;
  shipOpens: number;
  intakeOpens: string[][];
}

export function createInteractionLog(): OfficeInteractionLog {
  return {
    inspectorOpens: [],
    inboxFocus: [],
    pool2Opens: 0,
    mergeOpens: 0,
    shipOpens: 0,
    intakeOpens: [],
  };
}

export function createOfficeInteractionPorts(log: OfficeInteractionLog): OfficeInteractionPorts {
  return {
    inspector: {
      open(request) {
        log.inspectorOpens.push(request);
      },
    },
    inbox: {
      focusTopActionable(request) {
        log.inboxFocus.push({ cardId: request.cardId });
      },
    },
    summaries: {
      openPool2() {
        log.pool2Opens += 1;
      },
      openMergeQueue() {
        log.mergeOpens += 1;
      },
      openShip() {
        log.shipOpens += 1;
      },
      openExternalIntake(request) {
        log.intakeOpens.push([...request.itemIds]);
      },
    },
  };
}

function defaultPorts(): OfficeInteractionPorts {
  return {
    inspector: {
      open() {
        return undefined;
      },
    },
    inbox: {
      focusTopActionable() {
        return undefined;
      },
    },
    summaries: {
      openPool2() {
        return undefined;
      },
      openMergeQueue() {
        return undefined;
      },
      openShip() {
        return undefined;
      },
      openExternalIntake() {
        return undefined;
      },
    },
  };
}

/**
 * Hover and click routing. Sibling panels are reached through ports:
 * WorkerInspectorPanel (Task 126), Calm Inbox (Task 127), Pool 2 / Merge / Ship
 * summaries, and External Intake (Tasks 097–100).
 */
export class OfficeInteractionController {
  private readonly flows = new PaperAndParcelFlowVisuals();

  constructor(
    private readonly scene: OfficeCastScene,
    private readonly snapshot: OfficeCanonicalSnapshot,
    private readonly ports: OfficeInteractionPorts = defaultPorts(),
  ) {}

  hover(target: OfficeHoverTarget): OfficeHoverTooltip | null {
    const agentId = target.agentId;
    const seat = this.scene.seats.find((item) => item.agentId === agentId);
    const worker = this.snapshot.workers.find((item) => item.agentId === agentId);
    if (!seat && !worker) return null;
    const resolvedId = worker?.agentId ?? seat?.agentId ?? agentId;
    return {
      agentId: resolvedId,
      tag: seat?.tag.text ?? worker?.agentId ?? resolvedId,
      fullTitle: seat?.tag.fullTitle ?? worker?.taskTitle ?? "",
      statusLine: worker ? formatOfficeStatusLine(worker) : (seat?.status ?? "done"),
      modelName: worker?.modelName ?? "",
      connectionLabel: seat?.pin.label ?? worker?.connection ?? "",
      connectionColor: seat?.pin.color ?? "",
      connectionShape: seat?.pin.shape ?? "",
      level: seat?.outfit.tierLabel ?? "Mid",
      elapsedSeconds: worker?.elapsedSeconds ?? 0,
      healthLabel: worker?.health?.label ?? null,
    };
  }

  click(target: OfficeClickTarget): InteractionEffect {
    switch (target.kind) {
      case "worker":
        return this.openInspector(target.agentId, target.taskId);
      case "ceo-desk":
      case "inbox-tray":
        return this.focusInbox();
      case "qa-test-rig":
        this.ports.summaries.openPool2({ rigIndex: target.rigIndex });
        return { type: "open-pool2-summary", rigIndex: target.rigIndex };
      case "merge-bay":
        this.ports.summaries.openMergeQueue();
        return { type: "open-merge-queue-summary" };
      case "shipping-dock":
        this.ports.summaries.openShip();
        return { type: "open-ship-summary" };
      case "front-desk-parcel": {
        const itemIds = this.scene.parcel?.itemIds ?? [];
        this.ports.summaries.openExternalIntake({ itemIds });
        return { type: "open-external-intake", itemIds };
      }
      default: {
        const unexpected: never = target;
        throw new Error(`Unhandled office click ${JSON.stringify(unexpected)}`);
      }
    }
  }

  private openInspector(agentId: string, taskId: string): InteractionEffect {
    const seat = this.findSeat(agentId, taskId);
    const worker = this.findWorker(agentId, taskId);
    const resolvedTaskId = worker?.taskId ?? seat?.taskId ?? taskId;
    const resolvedAgentId = worker?.agentId ?? seat?.agentId ?? agentId;
    const completed =
      worker === undefined || worker.status === "done" || worker.status === "passed";
    const request: WorkerInspectorOpenRequest = {
      taskId: resolvedTaskId,
      agentId: resolvedAgentId,
      completed,
      tabs: ["Timeline", "Diff"],
    };
    this.ports.inspector.open(request);
    return {
      type: "open-worker-inspector",
      taskId: resolvedTaskId,
      agentId: resolvedAgentId,
      completed,
    };
  }

  private focusInbox(): InteractionEffect {
    const top = this.flows.topActionableCard(this.snapshot);
    const cardId = top?.cardId ?? null;
    this.ports.inbox.focusTopActionable({ cardId });
    return { type: "focus-calm-inbox", cardId };
  }

  private findSeat(agentId: string, taskId: string): SeatedCastMember | undefined {
    return (
      this.scene.seats.find((seat) => seat.agentId === agentId) ??
      this.scene.seats.find((seat) => seat.taskId === taskId)
    );
  }

  private findWorker(agentId: string, taskId: string) {
    return (
      this.snapshot.workers.find((worker) => worker.agentId === agentId) ??
      this.snapshot.workers.find((worker) => worker.taskId === taskId)
    );
  }
}
