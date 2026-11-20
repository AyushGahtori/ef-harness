import { matchesScopePredicate, normalizeTouchTag, type TouchTag } from "./closed-tags.js";
import type { SeamId, SeamMatchCase, SeamTemplate } from "./seams.js";

export interface SeamParty {
  readonly id: string;
  readonly kind: "task" | "feature";
  readonly tags: readonly string[];
  readonly entities: readonly string[];
  readonly endpoints: readonly string[];
  readonly events: readonly string[];
}

export interface SeamMatchQuery {
  readonly left: SeamParty;
  readonly right: SeamParty;
}

export interface SeamProposal {
  readonly seamId: SeamId;
  readonly name: string;
  readonly ruleIds: readonly string[];
  readonly sharedEntities: readonly string[];
  readonly sharedEndpoints: readonly string[];
  readonly sharedEvents: readonly string[];
}

function intersect(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))].sort();
}

export function closedTagsOf(tags: readonly string[]): Set<TouchTag> {
  const out = new Set<TouchTag>();
  for (const tag of tags) {
    const closed = normalizeTouchTag(tag);
    if (closed) out.add(closed);
  }
  return out;
}

export function seamActivates(seam: SeamTemplate, query: SeamMatchQuery): boolean {
  const sharedEntities = intersect(query.left.entities, query.right.entities);
  const sharedEndpoints = intersect(query.left.endpoints, query.right.endpoints);
  const sharedEvents = intersect(query.left.events, query.right.events);
  const sharedByKind = {
    entity: sharedEntities.length > 0,
    endpoint: sharedEndpoints.length > 0,
    event: sharedEvents.length > 0,
  };
  if (!seam.activation.shared.some((kind) => sharedByKind[kind])) return false;
  const tags = closedTagsOf([...query.left.tags, ...query.right.tags]);
  return matchesScopePredicate(seam.activation.scope, tags, false);
}

export function queryFromMatchCase(seam: SeamTemplate, matchCase: SeamMatchCase): SeamMatchQuery {
  return {
    left: {
      id: `${seam.id}-left`,
      kind: "task",
      tags: matchCase.tags,
      entities: matchCase.sharedEntities,
      endpoints: matchCase.sharedEndpoints,
      events: matchCase.sharedEvents,
    },
    right: {
      id: `${seam.id}-right`,
      kind: "feature",
      tags: [],
      entities: matchCase.sharedEntities,
      endpoints: matchCase.sharedEndpoints,
      events: matchCase.sharedEvents,
    },
  };
}

export class SeamTaskAutoMatcher {
  constructor(private readonly seams: readonly SeamTemplate[]) {}

  match(query: SeamMatchQuery): readonly SeamProposal[] {
    const proposals: SeamProposal[] = [];
    for (const seam of this.seams) {
      if (!seamActivates(seam, query)) continue;
      proposals.push({
        seamId: seam.id,
        name: seam.name,
        ruleIds: [...seam.ruleIds],
        sharedEntities: intersect(query.left.entities, query.right.entities),
        sharedEndpoints: intersect(query.left.endpoints, query.right.endpoints),
        sharedEvents: intersect(query.left.events, query.right.events),
      });
    }
    proposals.sort((left, right) => left.seamId.localeCompare(right.seamId));
    return proposals;
  }
}
