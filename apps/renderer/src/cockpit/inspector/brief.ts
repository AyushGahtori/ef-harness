import { MAX_MOUNTED_SKILLS } from "./constants.js";
import { el, type InspectorElement } from "./elements.js";
import { formatTokens } from "./format.js";
import type { BriefPull, HandoffRead, PinnedBrief } from "./types.js";

const RULE_ID = /^X-(0[1-9]|1[0-4])$/;

export interface BriefViewInput {
  readonly brief: PinnedBrief | null;
  readonly handoffReads: readonly HandoffRead[];
  readonly upcoming: boolean;
  readonly error: string | null;
}

/**
 * Renders the attempt's pinned slice. Requirement text is the historical
 * `node_versions` body. A later graph edit shows a badge and does not replace it.
 */
export class PinnedBriefReadSetViewer {
  render(input: BriefViewInput): InspectorElement {
    if (input.error) {
      return el("tabpanel", "Brief", "", [el("alert", "Brief error", input.error)]);
    }
    if (!input.brief) {
      return el("tabpanel", "Brief", "", [el("note", "Brief empty", "No pinned brief")]);
    }
    const brief = input.brief;
    const heading = input.upcoming ? "Upcoming brief" : "Pinned brief";
    const children: InspectorElement[] = [
      el("note", heading, brief.goal),
      el("note", "sliceSha256", brief.sliceSha256),
      el("note", "MUST", formatTokens(brief.mustTokens)),
      el("note", "SHOULD", formatTokens(brief.shouldTokens)),
      el("note", "COULD", formatTokens(brief.couldTokens)),
    ];
    for (const requirement of brief.requirements) {
      const version = brief.nodeVersions[requirement.id];
      children.push(
        el(
          "button",
          requirement.id,
          requirement.text,
          [],
          {
            band: requirement.band,
            version: requirement.version,
            pinnedVersion: version ?? requirement.version,
          },
        ),
      );
      if (requirement.laterVersion !== null && requirement.laterVersion !== requirement.version) {
        children.push(el("note", `${requirement.id} updated later`, `${requirement.id} updated later`));
      }
    }
    for (const rule of brief.rules) {
      if (!RULE_ID.test(rule.id)) continue;
      children.push(el("item", rule.id, rule.text));
    }
    const mounted = brief.skills.slice(0, MAX_MOUNTED_SKILLS);
    for (const skill of mounted) {
      children.push(el("item", skill.id, skill.sha256, [], { mounted: true }));
    }
    if (brief.skills.length > MAX_MOUNTED_SKILLS) {
      children.push(el("alert", "Skill cap", "Skill mount refused above 2"));
    }
    for (const path of brief.writeScope) {
      children.push(el("item", "Owned write scope", path));
    }
    const pulls = brief.pulls.filter((pull) => pull.tool.startsWith("kb."));
    for (const pull of pulls) children.push(renderPull(pull));
    for (const read of input.handoffReads) {
      children.push(
        el("button", read.handoffId, `${read.tool} ${read.summary}`, [], { tool: read.tool }),
      );
    }
    return el("tabpanel", "Brief", heading, children);
  }
}

function renderPull(pull: BriefPull): InspectorElement {
  return el("item", pull.tool, pull.targetId, [], { kind: "kb-pull" });
}
