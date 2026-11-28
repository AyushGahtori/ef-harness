import type { OfficeCanonicalSnapshot, OfficeViewState, SeatedCastMember } from "../cast/types.js";
import { OfficeCastProjector } from "../cast/office-cast-projector.js";
import type { OfficeCastScene } from "../cast/types.js";
import type { CastProjection, HealthSignal, OfficeCastProjectorPort, OfficeStatusIcon } from "./types.js";

function statusIconFor(seat: SeatedCastMember): OfficeStatusIcon {
  const icon = seat.overhead.icon;
  if (icon === "green-check" || seat.status === "done" || seat.status === "passed") return "checkmark";
  if (icon === "raised-hand" || seat.status === "waiting-on-you") return "question";
  if (icon === "pause-bars" || seat.status === "paused") return "paused";
  if (icon === "typing-dots" || seat.status === "thinking") return "typing";
  if (seat.status === "verifying") return "verifying";
  if (seat.status === "integrating") return "integrating";
  if (seat.status === "held") return "hold";
  if (seat.status === "running") return "working";
  return "idle";
}

function healthFor(seat: SeatedCastMember, snapshot: OfficeCanonicalSnapshot): HealthSignal {
  const worker = snapshot.workers.find((entry) => entry.agentId === seat.agentId);
  const kind = worker?.health?.kind;
  if (kind === "stuck_no_progress") return "stuck";
  if (kind === "loop_detected" || seat.status === "looping") return "loop";
  if (kind === "waiting_on_you" || seat.status === "waiting-on-you") return "waiting_on_you";
  if (seat.status === "held" || kind === "escalated_or_retrying") return "held";
  return "ok";
}

function projectionFor(seat: SeatedCastMember, snapshot: OfficeCanonicalSnapshot, nowMs: number): CastProjection {
  return {
    agentId: seat.agentId,
    truthfulRoomId: seat.roomId,
    statusIcon: statusIconFor(seat),
    health: healthFor(seat, snapshot),
    stateTimestampMs: nowMs,
    urgent: seat.flagged || seat.status === "waiting-on-you",
  };
}

/**
 * Adapts `OfficeCastProjector.project(snapshot)` to the per-agent
 * `OfficeCastProjectorPort` the animation director reads.
 */
export class OfficeCastProjectorPortAdapter implements OfficeCastProjectorPort {
  private readonly byAgent = new Map<string, CastProjection>();

  constructor(private readonly projector: OfficeCastProjector) {}

  publish(snapshot: OfficeCanonicalSnapshot, nowMs: number, view: OfficeViewState = { zoom: 1 }): OfficeCastScene {
    const scene = this.projector.project(snapshot, view);
    this.byAgent.clear();
    for (const seat of scene.seats) {
      this.byAgent.set(seat.agentId, projectionFor(seat, snapshot, nowMs));
    }
    return scene;
  }

  project(agentId: string): CastProjection | null {
    return this.byAgent.get(agentId) ?? null;
  }

  listActiveAgentIds(): readonly string[] {
    return [...this.byAgent.keys()];
  }
}
