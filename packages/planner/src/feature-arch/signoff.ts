import { canonicalJson, sha256 } from "./canonical.js";
import { ScreenSpecGenerator, walkComponents } from "./screen-spec.js";
import type { BoxChatEdit, ComponentNode, ScreenContext, ScreenRevision, ScreenSpec, WireframePair } from "./types.js";

export class ScreenSpecSignoff {
  private readonly screens = new ScreenSpecGenerator();

  revision(spec: ScreenSpec, wireframes: WireframePair): ScreenRevision {
    const hash = sha256(
      canonicalJson({
        spec,
        desktopSvg: wireframes.desktop.svg,
        mobileSvg: wireframes.mobile.svg,
        desktopAscii: wireframes.desktop.ascii,
        mobileAscii: wireframes.mobile.ascii,
      }),
    );
    return { screenId: spec.id, hash, spec, wireframes };
  }

  diffBundle(before: ScreenRevision, after: ScreenRevision): string {
    return [
      diffText(canonicalJson(before.spec), canonicalJson(after.spec)),
      diffText(before.wireframes.desktop.svg, after.wireframes.desktop.svg),
      diffText(before.wireframes.mobile.svg, after.wireframes.mobile.svg),
      diffText(before.wireframes.desktop.ascii, after.wireframes.desktop.ascii),
      diffText(before.wireframes.mobile.ascii, after.wireframes.mobile.ascii),
    ].join("\n");
  }

  applyEdit(
    spec: ScreenSpec,
    edit: BoxChatEdit,
    context?: ScreenContext,
  ): { ok: true; spec: ScreenSpec } | { ok: false; issues: string[] } {
    const next = structuredClone(spec);
    switch (edit.op) {
      case "set_label":
        if (edit.text.trim() === "") return { ok: false, issues: ["label text must be non-empty"] };
        if (!hasLabel(next, edit.labelId)) {
          return { ok: false, issues: [`unknown label ${edit.labelId}`] };
        }
        for (const label of next.labels) {
          if (label.id === edit.labelId) label.text = edit.text.trim();
        }
        rewriteLabels(next.components, edit.labelId, edit.text.trim());
        if (edit.labelId === "title") next.title = edit.text.trim();
        break;
      case "set_route":
        next.route = edit.route;
        break;
      case "set_roles":
        next.roles = [...edit.roles];
        break;
      case "set_states":
        next.states = [...edit.states];
        break;
      default: {
        const unreachable: never = edit;
        return unreachable;
      }
    }
    return this.screens.validate(next, context);
  }
}

function hasLabel(spec: ScreenSpec, id: string): boolean {
  if (spec.labels.some((label) => label.id === id)) return true;
  let found = false;
  walkComponents(spec.components, (node) => {
    if (node.id === id) found = true;
  });
  return found;
}

function rewriteLabels(nodes: ComponentNode[], id: string, text: string): void {
  for (const node of nodes) {
    if (node.id === id) node.label = text;
    if (node.children) rewriteLabels(node.children, id, text);
  }
}

function diffText(before: string, after: string): string {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines = ["--- before", "+++ after"];
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const previous = left[index];
    const current = right[index];
    if (previous === current) continue;
    if (previous !== undefined) lines.push(`- ${previous}`);
    if (current !== undefined) lines.push(`+ ${current}`);
  }
  return lines.join("\n");
}
