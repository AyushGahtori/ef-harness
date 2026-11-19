/**
 * Tier A build gate from sandbox-and-security.md and research/windows-sandboxing.md.
 * 24H2 is build 26100 revision >= 9278. 25H2 is build 26200 revision >= 9278.
 * A build number alone is not MXC availability; the caller still probes processmodel.dll.
 */

export const MXC_24H2_BUILD = 26100;
export const MXC_25H2_BUILD = 26200;
export const MXC_REVISION = 9278;

/**
 * @param {number} buildNumber
 * @param {number} revision
 */
export function isMxcBuildEligible(buildNumber, revision) {
  if (!Number.isFinite(buildNumber) || !Number.isFinite(revision)) return false;
  if (buildNumber === MXC_24H2_BUILD && revision >= MXC_REVISION) return true;
  if (buildNumber === MXC_25H2_BUILD && revision >= MXC_REVISION) return true;
  if (buildNumber > MXC_25H2_BUILD && revision >= 0) return true;
  if (buildNumber > MXC_24H2_BUILD && buildNumber < MXC_25H2_BUILD && revision >= MXC_REVISION) return true;
  return false;
}

/**
 * @param {string} text
 */
export function parseBuildText(text) {
  const match = /(\d+)\.(\d+)/.exec(text.trim());
  if (!match) return null;
  return { buildNumber: Number(match[1]), revision: Number(match[2]) };
}
