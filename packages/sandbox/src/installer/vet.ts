import { highestSatisfying, versionSatisfies } from "./semver.js";
import { evaluateLicense } from "./spdx.js";
import { checkTyposquat } from "./typosquat.js";
import type {
  AdvisorySource,
  AgeCheck,
  DependencyIntent,
  LicensePolicy,
  PackageMetadataSource,
  PackageVersionMetadata,
  SupplyChainVetReport,
  VulnerabilityFinding,
} from "./types.js";

export const DEFAULT_MIN_AGE_HOURS = 72;

export const EMPTY_ADVISORIES: AdvisorySource = {
  lookup: () => [],
};

export interface VetContext {
  readonly metadata: PackageMetadataSource;
  readonly advisories: AdvisorySource;
  readonly now: Date;
  readonly minAgeHours: number;
  readonly licensePolicy: LicensePolicy;
  readonly popularPackages?: readonly string[];
}

function ageCheck(publishedAt: string | null, now: Date, minAgeHours: number): AgeCheck {
  if (!publishedAt) {
    return { publishedAt: null, ageHours: null, minAgeHours, held: true };
  }
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) {
    return { publishedAt, ageHours: null, minAgeHours, held: true };
  }
  const ageHours = (now.getTime() - published.getTime()) / 3_600_000;
  return { publishedAt, ageHours, minAgeHours, held: ageHours < minAgeHours };
}

export function resolvePackageVersion(
  metadata: PackageMetadataSource,
  name: string,
  range: string,
  explicit?: string,
): PackageVersionMetadata | null {
  if (explicit) return metadata.getVersion(name, explicit);
  if (/^\d+\.\d+\.\d+$/.test(range.trim())) return metadata.getVersion(name, range.trim());
  const listed = metadata.listVersions?.(name) ?? [];
  const best = highestSatisfying(
    listed.map((item) => item.version),
    range,
  );
  return best ? metadata.getVersion(name, best) : null;
}

export function vetDependencyIntent(intent: DependencyIntent, context: VetContext): SupplyChainVetReport {
  const typosquat = checkTyposquat(intent.packageName, context.popularPackages);
  const resolved = resolvePackageVersion(
    context.metadata,
    intent.packageName,
    intent.range,
    intent.version,
  );
  const age = ageCheck(resolved?.publishedAt ?? null, context.now, context.minAgeHours);
  const version = resolved?.version ?? null;
  const vulnerabilities: VulnerabilityFinding[] = [];
  if (resolved) {
    for (const advisory of context.advisories.lookup(resolved.name, resolved.version)) {
      if (!versionSatisfies(resolved.version, advisory.range)) continue;
      const waived = (intent.waivedAdvisories ?? []).includes(advisory.id);
      const blocking = !waived && (advisory.severity === "high" || advisory.severity === "critical");
      vulnerabilities.push({
        id: advisory.id,
        severity: advisory.severity,
        waived,
        blocking,
      });
    }
  }
  const cveBlocked = vulnerabilities.some((finding) => finding.blocking);
  const license = evaluateLicense(resolved?.license ?? null, context.licensePolicy);
  const reasons: string[] = [];
  if (age.held) {
    reasons.push(
      age.ageHours === null
        ? `package version age is unknown and is held for ${context.minAgeHours}h`
        : `version published ${age.ageHours.toFixed(2)}h ago is under the ${context.minAgeHours}h minimum`,
    );
  }
  for (const finding of vulnerabilities) {
    if (finding.blocking) reasons.push(`blocking ${finding.severity} advisory ${finding.id}`);
    else if (finding.waived) reasons.push(`advisory ${finding.id} is explicitly waived`);
  }
  if (typosquat) {
    reasons.push(`typosquat of ${typosquat.similarTo} (${typosquat.reason})`);
  }
  if (license.flagged) {
    reasons.push(`license ${license.expression ?? "missing"} is ${license.status}`);
  }
  if (!resolved) reasons.push("version could not be resolved from local registry metadata");
  let decision: SupplyChainVetReport["decision"] = "allow";
  if (typosquat || cveBlocked) decision = "deny";
  else if (age.held || license.flagged || !resolved) decision = "hold";
  return {
    packageName: intent.packageName,
    version,
    range: intent.range,
    decision,
    age,
    vulnerabilities,
    cveBlocked,
    typosquat,
    license,
    reasons,
  };
}
