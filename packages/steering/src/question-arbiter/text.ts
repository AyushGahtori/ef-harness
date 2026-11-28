import { createHash } from "node:crypto";
import type { QuestionKind } from "./constants.js";
import { InvalidQuestionError } from "./errors.js";
import type { QuestionCard, QuestionOption, QuestionReply } from "./types.js";

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeTopic(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function questionKey(input: {
  readonly scopeId?: string | undefined;
  readonly criterionId?: string | undefined;
  readonly text: string;
}): string {
  if (input.scopeId !== undefined && input.scopeId.length > 0 && input.criterionId !== undefined && input.criterionId.length > 0) {
    return `scope:${input.scopeId}\u001fcriterion:${input.criterionId}`;
  }
  return `topic:${sha256Text(normalizeTopic(input.text))}`;
}

export function blockingLabel(count: number): string {
  return count === 1 ? "Blocking 1 task" : `Blocking ${count} tasks`;
}

export function whyThisMatters(count: number): string {
  return count === 1 ? "Why this matters (blocks 1 task)" : `Why this matters (blocks ${count} tasks)`;
}

export function staleHeadline(settledBy: string): string {
  return `This question was already resolved by ${settledBy} — Keep ${settledBy} or Change to your new reply?`;
}

export function concreteOptions(
  text: string,
  kind: QuestionKind,
  supplied?: readonly string[],
  recommendedOptionId?: string,
): { readonly options: readonly QuestionOption[]; readonly recommendedOptionId: string } {
  const labels = supplied !== undefined && supplied.length > 0 ? supplied : defaultLabels(text, kind);
  if (labels.length === 0) throw new InvalidQuestionError("A question card needs at least one option.");
  const options = labels.map((label, index) => ({
    number: index + 1,
    id: `opt-${index + 1}`,
    label,
  }));
  const first = options[0];
  if (!first) throw new InvalidQuestionError("A question card needs at least one option.");
  const recommended =
    recommendedOptionId !== undefined && options.some((option) => option.id === recommendedOptionId)
      ? recommendedOptionId
      : first.id;
  return { options, recommendedOptionId: recommended };
}

function defaultLabels(text: string, kind: QuestionKind): readonly string[] {
  if (kind === "approval") return ["Approve the requested action", "Deny the requested action"];
  if (kind === "secret") return ["Provide the secret for this project", "Leave the secret unset"];
  if (kind === "human_step") return ["I completed the human step", "I cannot complete it yet"];
  if (/date format/i.test(text)) return ["ISO 8601 (YYYY-MM-DD)", "Locale short date"];
  if (/^\s*should\b/i.test(text)) return ["Yes", "No"];
  if (kind === "advisory") return ["Noted", "Dismiss"];
  return ["Accept the recommended default", "Choose a different rule"];
}

export function assertToken(value: string, label: string): void {
  if (value.trim().length === 0 || /\s/.test(value)) {
    throw new InvalidQuestionError(`${label} must be a non-empty token.`);
  }
}

export function replyText(card: QuestionCard, reply: QuestionReply): string {
  const resolved = resolveReplyText(card, reply);
  if (resolved === null) throw new InvalidQuestionError("A reply needs an option or text.");
  return resolved;
}

export function resolveReplyText(card: QuestionCard, reply: QuestionReply): string | null {
  if (reply.optionId !== undefined) {
    const option = card.options.find((item) => item.id === reply.optionId);
    if (option) return option.label;
  }
  if (reply.text !== undefined && reply.text.trim().length > 0) return reply.text.trim();
  if (reply.optionId !== undefined && reply.optionId.trim().length > 0) return reply.optionId.trim();
  return null;
}

export function repliesAgree(card: QuestionCard, reply: QuestionReply): boolean {
  if (card.settledAnswer === null) return false;
  if (reply.optionId !== undefined && card.settledOptionId !== null && reply.optionId === card.settledOptionId) {
    return true;
  }
  const text = resolveReplyText(card, reply);
  if (text === null) return false;
  return normalizeTopic(text) === normalizeTopic(card.settledAnswer);
}
