import { placeAgentLabels } from "./label-collision.js";
import type { DeskPinVisual, OfficeViewState, PlacedAgentLabel, SeatedCastMember } from "./types.js";

export interface LabelAndPinLayer {
  readonly labels: readonly PlacedAgentLabel[];
  readonly pins: readonly DeskPinVisual[];
}

/** Worker tags and the connection-color desk pin on each occupied desk. */
export class AgentLabelAndDeskPinLayer {
  build(seats: readonly SeatedCastMember[], view: OfficeViewState): LabelAndPinLayer {
    const pins: DeskPinVisual[] = seats.map((seat) => ({
      agentId: seat.agentId,
      taskId: seat.taskId,
      roomId: seat.roomId,
      x: seat.x + 10,
      y: seat.y - 4,
      color: seat.pin.color,
      colorHex: seat.pin.colorHex,
      shape: seat.pin.shape,
      label: seat.pin.label,
      tooltipText: `${seat.pin.label} \u00b7 ${seat.pin.color} ${seat.pin.shape}`,
    }));
    return {
      labels: placeAgentLabels(seats, view),
      pins,
    };
  }
}
