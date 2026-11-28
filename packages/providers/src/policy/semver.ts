export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(input: string): SemVer | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(input.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  return { major, minor, patch };
}

export function compareSemVer(left: SemVer, right: SemVer): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function semverInInclusiveRange(version: SemVer, from: SemVer, to: SemVer): boolean {
  return compareSemVer(version, from) >= 0 && compareSemVer(version, to) <= 0;
}

export function bumpPatch(version: string): string {
  const parsed = parseSemVer(version);
  if (!parsed) return version;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function displayVersion(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}
