import { DebouncedAriaLive } from "./debounced-aria-live.js";
import { reduceOfficeFocusTrap } from "./focus-trap.js";
import { HotDeskOverflowAggregator } from "./hot-desk-overflow-aggregator.js";
import {
  OFFICE_LOGICAL_TAB_ROOMS,
  OFFICE_ROOM_LABEL,
  type InboxPort,
  type OfficeCameraPort,
  type OfficeRoomId,
  type OfficeSelection,
  type OfficeWorkerRecord,
  type WorkerInspectorPort,
} from "./types.js";

export interface MirrorFocusNode {
  readonly id: string;
  readonly tabIndex: number;
  readonly roomId: OfficeRoomId;
  readonly agentId: string;
  readonly label: string;
}

export type MirrorKeyDecision =
  | { readonly type: "noop" }
  | { readonly type: "focus"; readonly node: MirrorFocusNode }
  | { readonly type: "activate"; readonly node: MirrorFocusNode }
  | { readonly type: "overflow"; readonly label: string }
  | { readonly type: "exit"; readonly target: "inspector" | "composer" };

function formatAgentTag(worker: OfficeWorkerRecord): string {
  return `${worker.agentId} · ${worker.title} — ${worker.stateLabel}`;
}

function workersInRoom(workers: readonly OfficeWorkerRecord[], roomId: OfficeRoomId): OfficeWorkerRecord[] {
  return workers.filter((worker) => worker.roomId === roomId);
}

/**
 * Semantic DOM mirror for the PixiJS office canvas: logical tab order, aria-live, and keyboard sync.
 */
export class OfficeSemanticMirrorTree {
  private workers: OfficeWorkerRecord[] = [];
  private inboxCount = 0;
  private focusedId: string | null = null;
  private readonly overflow = new HotDeskOverflowAggregator();
  private readonly live = new DebouncedAriaLive();
  private tabIndex = 1;

  constructor(
    private readonly camera: OfficeCameraPort,
    private readonly inspector: WorkerInspectorPort,
    private readonly inbox: InboxPort,
  ) {}

  replaceWorkers(workers: readonly OfficeWorkerRecord[], inboxCount: number): void {
    this.workers = [...workers];
    this.inboxCount = inboxCount;
  }

  announce(message: string): void {
    this.live.queue(message);
  }

  drainAriaLive(): string {
    this.live.flush();
    return this.live.peekRendered();
  }

  focusNodes(): MirrorFocusNode[] {
    this.tabIndex = 1;
    const nodes: MirrorFocusNode[] = [];
    const snapshot = this.overflow.aggregate(this.workers);
    for (const roomId of OFFICE_LOGICAL_TAB_ROOMS) {
      if (roomId === "ceo_office" && this.inboxCount > 0) {
        nodes.push({
          id: "ceo-inbox",
          tabIndex: this.tabIndex++,
          roomId,
          agentId: "inbox",
          label: `${OFFICE_ROOM_LABEL.ceo_office} — ${this.inboxCount} inbox items`,
        });
      }
      const roomWorkers =
        roomId === "engineering_bullpen"
          ? snapshot.seated
              .map((placement) => placement.worker)
              .filter((worker) => worker.roomId === "engineering_bullpen")
          : workersInRoom(this.workers, roomId);
      for (const worker of roomWorkers) {
        nodes.push({
          id: `worker-${worker.agentId}`,
          tabIndex: this.tabIndex++,
          roomId,
          agentId: worker.agentId,
          label: formatAgentTag(worker),
        });
      }
    }
    if (snapshot.overflowCount > 0) {
      nodes.push({
        id: "hot-desk-overflow",
        tabIndex: this.tabIndex++,
        roomId: "engineering_bullpen",
        agentId: "overflow",
        label: snapshot.overflowLabel,
      });
    }
    return nodes;
  }

  handleKeyDown(event: {
    readonly key: string;
    readonly shiftKey: boolean;
  }): MirrorKeyDecision {
    const nodes = this.focusNodes();
    if (event.key === "Tab") {
      const trap = reduceOfficeFocusTrap({
        nodes: nodes.map((node) => ({ id: node.id, tabIndex: node.tabIndex, label: node.label })),
        focusedId: this.focusedId,
        key: "Tab",
        shift: event.shiftKey,
      });
      if (trap.type === "focus") {
        const node = nodes.find((entry) => entry.id === trap.id);
        if (!node) return { type: "noop" };
        return this.applyFocus(node);
      }
      if (trap.type === "exit") return trap;
      return { type: "noop" };
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      return this.moveFocus(nodes, 1);
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      return this.moveFocus(nodes, -1);
    }
    if (event.key === "Enter" || event.key === " ") {
      const node = nodes.find((entry) => entry.id === this.focusedId);
      if (!node) return { type: "noop" };
      return this.activate(node);
    }
    return { type: "noop" };
  }

  renderHtml(): string {
    const nodes = this.focusNodes();
    const liveText = this.live.peekRendered();
    const activeDomTabId = this.focusedId ?? nodes[0]?.id ?? null;
    const rooms = OFFICE_LOGICAL_TAB_ROOMS.map((roomId) => {
      const heading =
        roomId === "ceo_office"
          ? this.overflow.roomHeading("ceo_office", this.inboxCount)
          : this.overflow.roomHeading(roomId, 0);
      const roomNodes = nodes.filter((node) => node.roomId === roomId);
      const items = roomNodes
        .map((node) => {
          const focused = node.id === this.focusedId;
          const domTabIndex = node.id === activeDomTabId ? "0" : "-1";
          return `<button type="button" class="office-mirror-node${focused ? " office-mirror-node--focus" : ""}" data-mirror-id="${node.id}" tabindex="${domTabIndex}" aria-label="${escapeHtml(node.label)}">${escapeHtml(node.label)}</button>`;
        })
        .join("");
      return `<section data-room="${roomId}"><h3>${escapeHtml(heading)}</h3>${items}</section>`;
    }).join("");
    return `<style>
.office-mirror{font:600 14px/1.4 Segoe UI,sans-serif;color:#f4f4f4;background:#101418;padding:12px;border:2px solid #f4f4f4}
.office-mirror h3{margin:12px 0 6px;font-size:15px;color:#ffffff}
.office-mirror-node{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;background:#1b2229;color:#f4f4f4;border:2px solid #c9d4e3;border-radius:4px}
.office-mirror-node--focus{outline:3px solid #ffbf47;outline-offset:2px}
.office-mirror-live{min-height:1.2em;margin-bottom:8px;color:#ffffff}
</style>
<div id="office-semantic-mirror" role="region" aria-label="Office View" class="office-mirror${liveText ? " office-mirror--live" : ""}">
  <div aria-live="polite" class="office-mirror-live">${escapeHtml(liveText)}</div>
  ${rooms}
</div>`;
  }

  snapshotSelection(): OfficeSelection | null {
    const node = this.focusNodes().find((entry) => entry.id === this.focusedId);
    if (!node || node.agentId === "inbox" || node.agentId === "overflow") return null;
    const worker = this.workers.find((entry) => entry.agentId === node.agentId);
    if (!worker) return null;
    return { agentId: worker.agentId, title: worker.title, openedBy: "keyboard" };
  }

  private moveFocus(nodes: MirrorFocusNode[], delta: number): MirrorKeyDecision {
    if (nodes.length === 0) return { type: "noop" };
    const currentIndex = nodes.findIndex((node) => node.id === this.focusedId);
    const base = currentIndex < 0 ? (delta > 0 ? -1 : nodes.length) : currentIndex;
    const next = nodes[(base + delta + nodes.length) % nodes.length];
    if (!next) return { type: "noop" };
    return this.applyFocus(next);
  }

  private applyFocus(node: MirrorFocusNode): MirrorKeyDecision {
    this.focusedId = node.id;
    this.camera.panToAgent(node.agentId);
    this.camera.setFocusRing(node.agentId);
    return { type: "focus", node };
  }

  private activate(node: MirrorFocusNode): MirrorKeyDecision {
    if (node.agentId === "overflow") {
      return { type: "overflow", label: node.label };
    }
    if (node.agentId === "inbox") {
      this.inbox.openFromCeoInbox();
      return { type: "activate", node };
    }
    const worker = this.workers.find((entry) => entry.agentId === node.agentId);
    const selection: OfficeSelection = {
      agentId: node.agentId,
      title: worker?.title ?? node.label,
      openedBy: "keyboard",
    };
    this.inspector.open(selection);
    return { type: "activate", node };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}