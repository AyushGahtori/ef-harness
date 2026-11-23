import type {
  OfficeCanonicalSnapshot,
  OfficeFeatureRecord,
  OfficeHelperRecord,
  OfficeInboxCard,
  OfficeIntakeItem,
  OfficeWorkerRecord,
} from "../../src/office/cast/index.js";

export function makeWorker(overrides: Partial<OfficeWorkerRecord> = {}): OfficeWorkerRecord {
  const base: OfficeWorkerRecord = {
    agentId: "A0014",
    taskId: "T-14",
    taskTitle: "print page",
    role: "coder",
    tier: "mid",
    status: "thinking",
    connection: "ChatGPT plan",
    modelName: "Luna",
    elapsedSeconds: 14,
    featureId: "F-Orders",
    featureTitle: "Orders",
    helpers: [],
  };
  return { ...base, ...overrides };
}

export function makeSnapshot(
  workers: readonly OfficeWorkerRecord[],
  extras: {
    readonly inboxCards?: readonly OfficeInboxCard[];
    readonly intakeItems?: readonly OfficeIntakeItem[];
    readonly features?: readonly OfficeFeatureRecord[];
    readonly pool2SlotCapacity?: number;
  } = {},
): OfficeCanonicalSnapshot {
  return {
    workers,
    inboxCards: extras.inboxCards ?? [],
    intakeItems: extras.intakeItems ?? [],
    features: extras.features ?? [],
    pool2SlotCapacity: extras.pool2SlotCapacity,
  };
}

export function makeHelper(leadAgentId: string, index: number, kind = "final-project-auditor@1"): OfficeHelperRecord {
  return {
    helperId: `H-${leadAgentId}-${index}`,
    leadAgentId,
    kind,
  };
}