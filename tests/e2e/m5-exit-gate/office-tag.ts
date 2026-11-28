import { formatAgentOfficeTag as formatRenderedOfficeTag } from "@ef-harness/renderer";

export interface AgentOfficeTag {
  readonly agentId: string;
  readonly shortTitle: string;
  readonly fullTitle: string;
  readonly text: string;
  readonly maxChars: 22;
}

export function formatAgentOfficeTag(agentId: string, fullTitle: string): AgentOfficeTag {
  const tag = formatRenderedOfficeTag(agentId, fullTitle);
  return {
    agentId: tag.agentId,
    shortTitle: tag.shortTitle,
    fullTitle: tag.fullTitle,
    text: tag.text,
    maxChars: 22,
  };
}
