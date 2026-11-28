import { readFileSync } from "node:fs";

import { OfficeCastProjector } from "../../src/office/cast/index.js";
import type {
  OfficeCanonicalSnapshot,
  OfficeFeatureRecord,
  OfficeHelperRecord,
  OfficeInboxCard,
  OfficeIntakeItem,
  OfficeWorkerRecord,
} from "../../src/office/cast/index.js";
import { TiledFloorPlanLoader } from "../../src/office/renderer/tiled-floor-plan-loader.js";
import type { LoadedFloorPlan } from "../../src/office/renderer/types.js";

export function loadFloorPlan(): LoadedFloorPlan {
  const raw = readFileSync(new URL("../../assets/office/floorplan-v1.tmj", import.meta.url), "utf8");
  return new TiledFloorPlanLoader().loadFromText(raw);
}

export function makeProjector(): OfficeCastProjector {
  return new OfficeCastProjector(loadFloorPlan());
}

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