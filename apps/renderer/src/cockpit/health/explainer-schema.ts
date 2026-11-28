export { CockpitExplainerV1Schema } from "@ef-harness/shared-contracts";

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

export function isOneSentence(text: string): boolean {
  const trimmed = text.trim();
  return countSentences(trimmed) === 1 && /[.!?]$/.test(trimmed);
}

export function ensureSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Nothing further was recorded.";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
