/**
 * Local ports for sibling tasks that are not on this base.
 * Integrators replace these names with the sibling exports listed in
 * `.agent-handoffs/task-163.md`. Do not import those packages from here:
 * their trees are disjoint and absent from this commit.
 */
export const SIBLING_PORT_SWAPS = [
  {
    local: "ROOM_IDS",
    owner: "Task 162",
    swapTo: "ROOM_IDS",
  },
  {
    local: "deskAnchor",
    owner: "Task 162",
    swapTo: "TiledFloorPlanLoader desk anchors via OfficePixiViewport",
  },
  {
    local: "formatOfficeStatusLine",
    owner: "Task 124",
    swapTo: "DeterministicStatusLineFormatter",
  },
  {
    local: "mapStatusToBoardLane",
    owner: "Task 124",
    swapTo: "mapTaskToBoardLane",
  },
  {
    local: "overheadIconFor",
    owner: "Task 125",
    swapTo: "BoardHealthSignalEngine",
  },
  {
    local: "OfficeInteractionPorts.inspector",
    owner: "Task 126",
    swapTo: "WorkerInspectorPanel",
  },
  {
    local: "OfficeInteractionPorts.inbox",
    owner: "Task 127",
    swapTo: "Calm Inbox",
  },
  {
    local: "rankOutfitFor",
    owner: "Task 106",
    swapTo: "VersionedModelRoster tiers",
  },
  {
    local: "pool2SlotCapacity",
    owner: "Task 119",
    swapTo: "ThreePoolCapacityScheduler Pool 2 slots",
  },
  {
    local: "OfficeInboxCard",
    owner: "Task 116",
    swapTo: "actionable inbox cards",
  },
  {
    local: "OfficeIntakeItem",
    owner: "Tasks 097-100",
    swapTo: "External Intake and brand-asset jobs",
  },
] as const;
