import type { FillMetrics } from "./types.js";

export function buildFillMetrics(
  activeCells: number,
  pass1Count: number,
  pass2Count: number,
  pass3Count: number,
  tokensSpent: number,
  llmCalls: number,
): FillMetrics {
  const percent = (count: number) => (activeCells === 0 ? 0 : Math.round((count / activeCells) * 100));
  return {
    activeCells,
    pass1Count,
    pass2Count,
    pass3Count,
    lines: [
      `Pass 1 Decisions/Rules: ${String(percent(pass1Count))}%`,
      `Pass 2 Elaborations/UP: ${String(percent(pass2Count))}%`,
      `Pass 3 LLM: ${String(percent(pass3Count))}%`,
    ],
    pass1Share: percent(pass1Count),
    pass2Share: percent(pass2Count),
    deterministicShare: activeCells === 0 ? 0 : ((pass1Count + pass2Count) / activeCells) * 100,
    tokensSpent,
    deterministicTokens: 0,
    llmCalls,
  };
}
