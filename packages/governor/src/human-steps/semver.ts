export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER = /(\d+)\.(\d+)\.(\d+)/;

export function parseSemver(text: string): Semver | null {
  const match = SEMVER.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function semverGte(actual: Semver, minimum: Semver): boolean {
  if (actual.major !== minimum.major) return actual.major > minimum.major;
  if (actual.minor !== minimum.minor) return actual.minor > minimum.minor;
  return actual.patch >= minimum.patch;
}
