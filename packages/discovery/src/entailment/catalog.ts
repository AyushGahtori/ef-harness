export interface InferenceRuleCatalog {
  allowedRules(criterionId: string): readonly string[];
}

export class MapInferenceCatalog implements InferenceRuleCatalog {
  constructor(private readonly rules: ReadonlyMap<string, readonly string[]>) {}

  allowedRules(criterionId: string): readonly string[] {
    return this.rules.get(criterionId) ?? [];
  }
}
