import fs from "node:fs/promises";
import path from "node:path";
import { SLOT_OWNER_MARKER_FILE, type MarkerKind, type SlotOwnerMarker } from "./types.js";

export async function writeSlotOwnerMarker(slotPath: string, marker: SlotOwnerMarker): Promise<void> {
  await fs.mkdir(slotPath, { recursive: true });
  const file = path.join(slotPath, SLOT_OWNER_MARKER_FILE);
  await fs.writeFile(file, `${JSON.stringify(marker)}\n`, "utf8");
}

export async function readSlotOwnerMarker(slotPath: string): Promise<SlotOwnerMarker | null> {
  const file = path.join(slotPath, SLOT_OWNER_MARKER_FILE);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.v !== 1) return null;
  if (typeof parsed.projectId !== "string" || parsed.projectId.length === 0) return null;
  if (parsed.slotId !== null && typeof parsed.slotId !== "string") return null;
  if (!isMarkerKind(parsed.kind)) return null;
  return {
    v: 1,
    projectId: parsed.projectId,
    slotId: parsed.slotId,
    kind: parsed.kind,
  };
}

export function markerMatchesProject(marker: SlotOwnerMarker | null, projectId: string): marker is SlotOwnerMarker {
  return marker !== null && marker.projectId === projectId;
}

function isMarkerKind(value: unknown): value is MarkerKind {
  return value === "attempt" || value === "integration" || value === "merge" || value === "project-root";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
