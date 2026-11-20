import type { ArchitectureViolation, SynthesisInput, SystemSkeleton } from "./types.js";
import { PHASE0_FOUNDATION, violation } from "./types.js";

const FATAL = new Set<ArchitectureViolation["code"]>(["dual_owner", "brownfield_rewrite"]);

export function isFatal(code: ArchitectureViolation["code"]): boolean {
  return FATAL.has(code);
}

export function fatalPrecheck(skeleton: SystemSkeleton, input: SynthesisInput): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const dual = dualOwnerViolation(skeleton);
  if (dual) violations.push(dual);
  if (input.mode === "brownfield") violations.push(...brownfieldViolations(skeleton, input));
  return violations;
}

export function sharedOwners(skeleton: SystemSkeleton): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const entity of skeleton.entities) owners[entity.id] = entity.owner;
  for (const contract of skeleton.contracts) owners[contract.id] = contract.producer;
  owners[skeleton.auth.contract_id] = owners[skeleton.auth.contract_id] ?? PHASE0_FOUNDATION;
  for (const event of skeleton.events) owners[event.id] = event.owner;
  return owners;
}

function dualOwnerViolation(skeleton: SystemSkeleton): ArchitectureViolation | null {
  const claims = new Map<string, string[]>();
  for (const feature of skeleton.feature_map) {
    for (const owned of feature.owns) {
      const list = claims.get(owned) ?? [];
      list.push(feature.id);
      claims.set(owned, list);
    }
  }
  for (const entity of skeleton.entities) {
    const claimers = claims.get(entity.id) ?? [];
    const owners = new Set<string>([entity.owner, ...claimers]);
    if (owners.size <= 1) continue;
    const extras = [...owners].filter((id) => id !== entity.owner);
    const name = entity.id.includes(":") ? entity.id.slice(entity.id.indexOf(":") + 1) : entity.id;
    return violation(
      "dual_owner",
      `Ownership invariant rejects dual owners of ${entity.id}. ${entity.owner} owns ${name}; ${extras.join(" and ")} consumes via contract/seam.`,
      [entity.id, entity.owner, ...extras],
    );
  }
  return null;
}

function brownfieldViolations(skeleton: SystemSkeleton, input: SynthesisInput): ArchitectureViolation[] {
  const observed = new Map((input.observedSubsystems ?? []).map((item) => [item.id, item]));
  const touched = new Set(input.touchedSubsystemIds ?? []);
  const violations: ArchitectureViolation[] = [];
  const seen = new Set<string>();
  const reject = (id: string): void => {
    if (seen.has(id)) return;
    const match = observed.get(id);
    if (!match || touched.has(id)) return;
    seen.add(id);
    violations.push(
      violation(
        "brownfield_rewrite",
        `Brownfield preservation forbids rewriting untouched subsystem ${match.id} at ${match.path}.`,
        [match.id],
      ),
    );
  };
  for (const component of skeleton.components) {
    if (component.action === "rewrite") reject(component.id);
  }
  for (const id of skeleton.rewrites) reject(id);
  return violations;
}
