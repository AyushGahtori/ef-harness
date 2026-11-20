export type ReleasePlacement = "current_release" | "future_milestone";

export interface ReleaseIntent {
  readonly feature: string;
  readonly placement: ReleasePlacement;
  readonly milestone: string | null;
  readonly moveToLater: boolean;
}

/**
 * Release-scope rules from project-discovery.md and open-design-questions.md.
 * A retracted feature contributes nothing. "Maybe add X" enters the current
 * release. "Add X after launch" enters that named future milestone.
 */
export function classifyReleaseIntent(text: string): ReleaseIntent[] {
  const future = new Map<string, string>();
  for (const feature of collect(text, /\badd\s+([a-z][\w-]*)\s+after\s+launch/gi)) {
    future.set(feature, "after launch");
  }
  const retracted = new Set(collect(text, /\b(?:actually,?\s+)?scrap\s+([a-z][\w-]*)/gi));
  const maybe = new Set(collect(text, /\bmaybe\s+add\s+([a-z][\w-]*)/gi));
  const names = new Set<string>([...future.keys(), ...retracted, ...maybe]);
  const intents: ReleaseIntent[] = [];
  for (const feature of [...names].sort()) {
    if (retracted.has(feature)) continue;
    if (future.has(feature)) {
      intents.push({
        feature,
        placement: "future_milestone",
        milestone: future.get(feature) ?? "after launch",
        moveToLater: false,
      });
      continue;
    }
    intents.push({
      feature,
      placement: "current_release",
      milestone: null,
      moveToLater: true,
    });
  }
  return intents;
}

function collect(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)]
    .map((match) => (match[1] ?? "").toLowerCase())
    .filter((feature) => feature.length > 0);
}
