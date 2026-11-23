import { createHash } from "node:crypto";
import type { FaultEvent } from "./types.js";

export function hashFaultTrace(events: readonly FaultEvent[]): string {
  const payload = events.map((e) => `${e.tick}|${e.class}|${e.hook ?? ""}|${e.detail}|${e.recovered}`).join("\n");
  return createHash("sha256").update(payload).digest("hex");
}