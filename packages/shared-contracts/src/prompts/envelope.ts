import { PromptEnvelopeError } from "./errors.js";

export const HONEST_EXIT_CLAUSE =
  'Honest exit: if answering would require a guess, return {"blocked":true,"reason":"<why>","missing_ids":["<id>"]} and no other keys.';

export interface PromptDataBlock {
  readonly source: string;
  readonly body: string;
}

export interface PromptEnvelopeRequest {
  readonly contractId: string;
  readonly kernelRules: string;
  readonly roleInstruction: string;
  readonly rubricVersion: string | null;
  readonly ruleVersions: readonly string[];
  readonly userText: string | null;
  readonly data: readonly PromptDataBlock[];
}

const CONTRACT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/;

/**
 * Escape text that will sit inside `<user>` or `<data>` so it cannot close the
 * provenance tag or open an `<instruction>` element. Ampersands are escaped
 * first so numeric character references cannot reassemble a tag.
 */
export function escapeProvenanceText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttribute(value: string): string {
  return escapeProvenanceText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("\r", "")
    .replaceAll("\n", " ");
}

function neutralizeInstructionBoundary(value: string): string {
  return value.replace(/<\s*\/\s*instruction\s*>/gi, "&lt;/instruction&gt;");
}

/**
 * Stable prefix first (kernel rules, role instruction, pinned contract/rubric/rule
 * versions, honest-exit clause), then the developer's words, then task data.
 */
export function buildPromptEnvelope(request: PromptEnvelopeRequest): string {
  if (!CONTRACT_ID_PATTERN.test(request.contractId)) {
    throw new PromptEnvelopeError("contractId must look like name@version");
  }
  const rules = request.ruleVersions.join(",");
  const opener = `<instruction contract="${escapeAttribute(request.contractId)}" rubric="${escapeAttribute(request.rubricVersion ?? "")}" rules="${escapeAttribute(rules)}">`;
  const instructionBody = [
    neutralizeInstructionBoundary(request.kernelRules.trim()),
    neutralizeInstructionBoundary(request.roleInstruction.trim()),
    HONEST_EXIT_CLAUSE,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
  const sections = [`${opener}\n${instructionBody}\n</instruction>`];
  if (request.userText !== null && request.userText.length > 0) {
    sections.push(`<user>\n${escapeProvenanceText(request.userText)}\n</user>`);
  }
  for (const block of request.data) {
    if (block.source.trim().length === 0) {
      throw new PromptEnvelopeError("data source is required");
    }
    sections.push(
      `<data source="${escapeAttribute(block.source)}">\n${escapeProvenanceText(block.body)}\n</data>`,
    );
  }
  return `${sections.join("\n")}\n`;
}
