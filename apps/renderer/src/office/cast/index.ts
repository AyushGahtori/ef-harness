export { AgentLabelAndDeskPinLayer } from "./agent-label-and-desk-pin-layer.js";
export { mapStatusToBoardLane } from "./board-lane.js";
export { CONNECTION_PINS, resolveConnection } from "./connection-pins.js";
export { buildFeaturePodPlinths } from "./feature-pod-labels.js";
export {
  AGENT_TAG_MAX_CHARS,
  AGENT_TAG_SEPARATOR,
  formatAgentOfficeTag,
  shortenTaskTitle,
} from "./format-agent-office-tag.js";
export { HelperSpriteClusterManager } from "./helper-sprite-cluster-manager.js";
export { placeAgentLabels } from "./label-collision.js";
export { OfficeCastProjector } from "./office-cast-projector.js";
export {
  createInteractionLog,
  createOfficeInteractionPorts,
  OfficeInteractionController,
} from "./office-interaction-controller.js";
export { overheadIconFor } from "./overhead-icons.js";
export { PaperAndParcelFlowVisuals } from "./paper-and-parcel-flow-visuals.js";
export { SIBLING_PORT_SWAPS } from "./ports.js";
export { rankOutfitFor } from "./rank-outfits.js";
export { clampRigCount, deskAnchor, roomForWorker } from "./rooms.js";
export { formatOfficeStatusLine } from "./status-line.js";
export { ROOM_IDS } from "./types.js";

export type {
  AgentOfficeTag,
  BoardLane,
  CeoTrayVisual,
  ConnectionPin,
  CrewTier,
  DeskPinVisual,
  FeaturePodPlinth,
  FrontDeskParcelVisual,
  HelperCountPill,
  InboxCardKind,
  OfficeCanonicalSnapshot,
  OfficeCastScene,
  OfficeFeatureRecord,
  OfficeHealthSignal,
  OfficeHelperRecord,
  OfficeInboxCard,
  OfficeIntakeItem,
  OfficeViewState,
  OfficeWorkerRecord,
  OfficeWorkerRole,
  OverheadIconId,
  PaperSlipVisual,
  PlacedAgentLabel,
  RankOutfit,
  RoomId,
  SeatedCastMember,
  TestRigVisual,
  TierLabel,
  VisibleHelperSprite,
  WorkerStatus,
} from "./types.js";

export type {
  InteractionEffect,
  OfficeClickTarget,
  OfficeHoverTarget,
  OfficeHoverTooltip,
  OfficeInteractionLog,
  OfficeInteractionPorts,
  WorkerInspectorOpenRequest,
} from "./office-interaction-controller.js";
