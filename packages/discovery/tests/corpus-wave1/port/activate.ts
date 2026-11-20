import type { CatalogQuestion, Elaboration, WaveBundle } from "./load.js";

export interface ActivationFlag {
  readonly criterion: string;
  readonly equals: string;
  readonly packId: string;
  readonly packTitle: string;
  readonly questionCount: number;
}

/**
 * requires_settled predicates. Task 075 question schema has applies_when, not a
 * requires_settled key, so each Wave 1 question stores the flag there.
 */
export function activationTable(bundle: WaveBundle): ActivationFlag[] {
  const byPack = new Map<string, ActivationFlag>();
  for (const question of bundle.questions) {
    const clause = question.applies_when[0];
    if (!clause?.equals) continue;
    const existing = byPack.get(question.packId);
    if (existing) {
      byPack.set(question.packId, { ...existing, questionCount: existing.questionCount + 1 });
      continue;
    }
    byPack.set(question.packId, {
      criterion: clause.criterion,
      equals: clause.equals,
      packId: question.packId,
      packTitle: question.packTitle,
      questionCount: 1,
    });
  }
  return [...byPack.values()];
}

export function deriveWave1Flags(
  settled: Readonly<Record<string, string>>,
  utterance = "",
): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const [key, value] of Object.entries(settled)) {
    if (key.endsWith(".activation") && value === "active") flags[key] = "active";
  }
  if (/\bstripe\b|paid pro tier/i.test(utterance)) flags["billing.activation"] = "active";
  if (/transactional email|notification preferences|unsubscribe|resend\/smtp|sms alerts|in-app bell/i.test(utterance)) {
    flags["messaging.activation"] = "active";
  }
  if (/ai chat|\brag\b|\bllm\b|language model|uploaded company pdfs/i.test(utterance)) {
    flags["ai.activation"] = "active";
  }
  if (/\bgdpr\b|\bccpa\b|right to be forgotten|uploaded company pdfs|regulated personal/i.test(utterance)) {
    flags["privacy.activation"] = "active";
  }
  if (settled["privacy.class"] === "regulated_personal_data") flags["privacy.activation"] = "active";
  return flags;
}

export function activeQuestions(
  bundle: WaveBundle,
  flags: Readonly<Record<string, string>>,
): CatalogQuestion[] {
  return bundle.questions.filter((question) =>
    question.applies_when.every((clause) => flags[clause.criterion] === clause.equals),
  );
}

export function questionsForPrompt(
  bundle: WaveBundle,
  settled: Readonly<Record<string, string>>,
  utterance: string,
): CatalogQuestion[] {
  return activeQuestions(bundle, deriveWave1Flags(settled, utterance));
}

/**
 * Local port of Task 074 DenominatorDeltaExplainer for a pack unlock.
 * The real explainer renders scope groups from state.db. This port renders the
 * Wave 1 group the task text requires.
 */
export class DenominatorDeltaExplainer {
  explain(before: readonly CatalogQuestion[], after: readonly CatalogQuestion[]): string {
    const beforeIds = new Set(before.map((question) => question.id));
    const added = after.filter((question) => !beforeIds.has(question.id));
    const groups = new Map<string, { title: string; count: number }>();
    for (const question of added) {
      const group = groups.get(question.packId) ?? { title: question.packTitle, count: 0 };
      group.count += 1;
      groups.set(question.packId, group);
    }
    const listed = [...groups.values()];
    if (listed.length === 1) {
      const group = listed[0];
      if (!group) throw new Error("missing unlock group");
      return `+${group.count} ${group.title} questions unlocked`;
    }
    const summary = listed.map((group) => `+${group.count} ${group.title}`).join(", ");
    return `${summary} questions unlocked`;
  }
}

export interface Layer1Warning {
  readonly warning: string;
  readonly offer: string | null;
}

export function layer1Warnings(
  elaborations: readonly Elaboration[],
  selection: Readonly<Record<string, string>>,
): Layer1Warning[] {
  const warnings: Layer1Warning[] = [];
  for (const elaboration of elaborations) {
    if (selection[elaboration.question] !== elaboration.option) continue;
    const conflict = elaboration.cells.find((cell) => cell.cell === "conflicts_with");
    if (!conflict) continue;
    const splitAt = conflict.value.indexOf(":");
    if (splitAt <= 0) continue;
    const questionId = conflict.value.slice(0, splitAt);
    const optionId = conflict.value.slice(splitAt + 1);
    if (selection[questionId] !== optionId) continue;
    const warning = elaboration.cells.find((cell) => cell.cell === "layer1_warning")?.value ?? conflict.value;
    const offer = elaboration.cells.find((cell) => cell.cell === "offered_alternative")?.value ?? null;
    warnings.push({ warning, offer });
  }
  return warnings;
}
