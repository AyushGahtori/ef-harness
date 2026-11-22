import { AGENT_TAG_MAX_CHARS } from "./types.js";

const SEPARATOR = " · ";
const ELLIPSIS = "…";

export interface AgentTag {
  readonly label: string;
  readonly full: string;
}

/** Office View identity: `A0014 · print page`, clamped to 22 characters. */
export function formatAgentTag(agentId: string, title: string): AgentTag {
  const full = `${agentId}${SEPARATOR}${title}`;
  if (full.length <= AGENT_TAG_MAX_CHARS) return { label: full, full };
  const prefix = `${agentId}${SEPARATOR}`;
  const room = AGENT_TAG_MAX_CHARS - prefix.length;
  if (room <= 1) {
    return { label: `${full.slice(0, AGENT_TAG_MAX_CHARS - 1)}${ELLIPSIS}`, full };
  }
  return { label: `${prefix}${title.slice(0, room - 1)}${ELLIPSIS}`, full };
}

export function formatTierPill(level: string): string {
  const key = level.trim().toLowerCase();
  if (key === "jr" || key === "junior") return "Jr";
  if (key === "mid" || key === "middle") return "Mid";
  if (key === "sr" || key === "senior") return "Sr";
  if (key.length === 0) return "Mid";
  return level.trim().slice(0, 8);
}

const CONNECTION_DOTS = ["#1d4ed8", "#0f766e", "#b45309", "#6d28d9", "#be123c", "#0369a1"] as const;

export function connectionDotColor(connectionId: string): string {
  let hash = 0;
  for (let index = 0; index < connectionId.length; index += 1) {
    hash = (hash + connectionId.charCodeAt(index)) % CONNECTION_DOTS.length;
  }
  return CONNECTION_DOTS[hash] ?? CONNECTION_DOTS[0];
}
