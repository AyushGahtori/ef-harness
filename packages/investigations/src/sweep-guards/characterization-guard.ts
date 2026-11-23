export type CharacterizationSafetyNetPort = {
  planBeforeTransform(modulePaths: readonly string[]): Promise<CharacterizationPlan>;
};

export type CharacterizationPlan = {
  readonly baselineTestIds: readonly string[];
  readonly characterizationTestIds: readonly string[];
};

export type CharacterizationGuardResult = {
  readonly required: boolean;
  readonly plan?: CharacterizationPlan;
  readonly proceed: boolean;
};

export class PreSweepCharacterizationGuard {
  constructor(private readonly port?: CharacterizationSafetyNetPort) {}

  async evaluate(modulesWithoutCoverage: readonly string[]): Promise<CharacterizationGuardResult> {
    if (modulesWithoutCoverage.length === 0) {
      return { required: false, proceed: true };
    }
    if (!this.port) {
      return { required: true, proceed: false };
    }
    const plan = await this.port.planBeforeTransform(modulesWithoutCoverage);
    return { required: true, plan, proceed: true };
  }
}