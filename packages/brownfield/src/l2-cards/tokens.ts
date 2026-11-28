export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function microUsdForInputTokens(tokens: number): number {
  // Cheap model batch pricing: ~$0.15 / 1M input tokens => 150 micro-USD per 1k tokens.
  return Math.round((tokens * 150) / 1_000);
}

export function planWindowPercentFromMicroUsd(microUsd: number, weeklyBudgetMicroUsd = 30_000): number {
  if (weeklyBudgetMicroUsd <= 0) return 0;
  return Number(((microUsd / weeklyBudgetMicroUsd) * 100).toFixed(2));
}