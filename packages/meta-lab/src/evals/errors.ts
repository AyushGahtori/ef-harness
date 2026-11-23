export class InvalidLifecycleTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    const suffix =
      from === "draft" && to === "active" ? " forbidden; must pass evaluated" : "";
    super(`Invalid lifecycle transition: ${from} → ${to}${suffix}`);
    this.name = "InvalidLifecycleTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class UnknownArtifactError extends Error {
  readonly artifactId: string;

  constructor(artifactId: string) {
    super(`Unknown artifact: ${artifactId}`);
    this.name = "UnknownArtifactError";
    this.artifactId = artifactId;
  }
}

export class FutilityAbortError extends Error {
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;

  constructor(baselinePassRate: number, candidatePassRate: number) {
    super(
      `Level 1 futility gate: candidate pass rate ${(candidatePassRate * 100).toFixed(1)}% dropped >5% below baseline ${(baselinePassRate * 100).toFixed(1)}%`,
    );
    this.name = "FutilityAbortError";
    this.baselinePassRate = baselinePassRate;
    this.candidatePassRate = candidatePassRate;
  }
}