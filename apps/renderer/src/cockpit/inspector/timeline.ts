import { el, type InspectorElement } from "./elements.js";
import { attemptGroupHeading } from "./format.js";
import { displayText } from "./redaction.js";
import type { AttemptSnapshot, HandoffHop, TimelineMilestone } from "./types.js";

export interface TimelineState {
  readonly attempts: readonly AttemptSnapshot[];
  readonly selectedAttemptId: string | null;
  readonly emptyMessage: string | null;
  readonly lineage: ReadonlyMap<string, readonly HandoffHop[]>;
}

/**
 * Default inspector tab. Structured milestones only — command JSON stays collapsed
 * and is rewritten before it can reach the tree.
 */
export class StructuredAttemptTimeline {
  private expanded = new Set<string>();
  private state: TimelineState = {
    attempts: [],
    selectedAttemptId: null,
    emptyMessage: null,
    lineage: new Map(),
  };

  setState(state: TimelineState): void {
    this.state = state;
  }

  toggleCommand(milestoneId: string): void {
    if (this.expanded.has(milestoneId)) this.expanded.delete(milestoneId);
    else this.expanded.add(milestoneId);
  }

  render(): InspectorElement {
    if (this.state.attempts.length === 0) {
      return el("tabpanel", "Timeline", "", [
        el("note", "Timeline empty", this.state.emptyMessage ?? "Queued"),
      ]);
    }
    const groups = this.state.attempts.map((attempt) => this.renderAttempt(attempt));
    return el("tabpanel", "Timeline", "", groups);
  }

  private renderAttempt(attempt: AttemptSnapshot): InspectorElement {
    const selected = attempt.attemptId === this.state.selectedAttemptId;
    const chain = attempt.milestones.map((milestone) => safeSummary(milestone)).join(" → ");
    const rows = attempt.milestones.map((milestone) => this.renderMilestone(milestone));
    return el(
      "group",
      attemptGroupHeading(attempt),
      chain,
      rows,
      { selected, attemptId: attempt.attemptId },
    );
  }

  private renderMilestone(milestone: TimelineMilestone): InspectorElement {
    const children: InspectorElement[] = [
      el("item", milestone.at, safeSummary(milestone)),
    ];
    if (milestone.handoffId) {
      const hops = this.state.lineage.get(milestone.handoffId) ?? [];
      const trail = hops.map((hop) => `${hop.fromRole} → ${hop.toRole}`).join(" · ");
      children.push(
        el("button", milestone.handoffId, trail || "Open handoff", [], {
          action: "canvas-node",
        }),
      );
    }
    if (milestone.filePath) {
      children.push(
        el("button", milestone.filePath, "Open file", [], { action: "editor" }),
      );
    }
    if (milestone.command) {
      children.push(el("button", `Show command ${milestone.id}`, "Show command summary"));
      if (this.expanded.has(milestone.id)) {
        children.push(el("note", `Command ${milestone.id}`, safeCommand(milestone)));
      }
    }
    return el("list", milestone.id, "", children);
  }
}

function safeSummary(milestone: TimelineMilestone): string {
  try {
    return displayText(milestone.summary, "timeline");
  } catch {
    return "Blocked: milestone was not pre-redacted";
  }
}

function safeCommand(milestone: TimelineMilestone): string {
  const parts: string[] = [];
  if (milestone.command) {
    try {
      parts.push(displayText(milestone.command, "command"));
    } catch {
      parts.push("Blocked: command was not pre-redacted");
    }
  }
  if (milestone.commandOutput) {
    try {
      parts.push(displayText(milestone.commandOutput, "command-output"));
    } catch {
      parts.push("Blocked: command output was not pre-redacted");
    }
  }
  return parts.join("\n");
}
