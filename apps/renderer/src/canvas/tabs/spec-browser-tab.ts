import { renderConflictStrip } from "./conflict-strip.js";
import { boolField, provenancePill, stringList, viewFilePath } from "./format.js";
import { escapeHtml, rootOpen, THEME } from "./html.js";
import { featureSpecMarkdown } from "./markdown.js";
import type { ClipboardPort, LowFiWireframeRendererPort, VsCodeOpenerPort } from "./ports.js";
import { LocalClipboard, LocalVsCodeOpener } from "./ports.js";
import type { CrossTabSelectionContext } from "./selection.js";
import type { CanonicalStateDb } from "./state-db.js";
import type { CanvasTheme, ConflictItem, FeatureOutline, OutlineNode, OutlineSnapshot } from "./types.js";
import { LocalLowFiWireframeRenderer } from "./wireframe.js";

export interface SpecBrowserOptions {
  readonly repoRoot?: string;
  readonly wireframes?: LowFiWireframeRendererPort;
  readonly vscode?: VsCodeOpenerPort;
  readonly clipboard?: ClipboardPort;
}

export class SpecBrowserTab {
  readonly vscode: VsCodeOpenerPort;
  readonly clipboard: ClipboardPort;
  readonly wireframes: LowFiWireframeRendererPort;
  readonly repoRoot: string;
  theme: CanvasTheme = "light";
  search = "";
  lastMarkdown = "";
  private readonly collapsed = new Set<string>();
  private focusId: string | null = null;
  private visibleIds: string[] = [];

  constructor(
    private readonly db: CanonicalStateDb,
    private readonly selection: CrossTabSelectionContext,
    options: SpecBrowserOptions = {},
  ) {
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.vscode = options.vscode ?? new LocalVsCodeOpener();
    this.clipboard = options.clipboard ?? new LocalClipboard();
    this.wireframes = options.wireframes ?? new LocalLowFiWireframeRenderer();
  }

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
  }

  setSearch(query: string): void {
    this.search = query;
    this.focusId = null;
  }

  toggle(id: string): void {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
  }

  pressKey(key: string): void {
    const ids = this.visibleIds;
    if (ids.length === 0) return;
    const index = Math.max(0, ids.indexOf(this.focusId ?? ids[0] ?? ""));
    if (key === "ArrowDown") this.focusId = ids[Math.min(ids.length - 1, index + 1)] ?? null;
    else if (key === "ArrowUp") this.focusId = ids[Math.max(0, index - 1)] ?? null;
    else if (key === "Home") this.focusId = ids[0] ?? null;
    else if (key === "End") this.focusId = ids[ids.length - 1] ?? null;
    else if (key === "ArrowRight" && this.focusId) this.collapsed.delete(this.focusId);
    else if (key === "ArrowLeft" && this.focusId) this.collapsed.add(this.focusId);
    else if (key === "Enter" && this.focusId) this.activate(this.focusId);
  }

  selectRequirement(requirementId: string): void {
    const outline = this.db.readOutline();
    const feature = outline.features.find((item) => item.requirements.some((requirement) => requirement.id === requirementId));
    this.focusId = requirementId;
    this.selection.select({
      tab: "spec",
      featureId: feature?.id ?? this.selection.featureId,
      requirementId,
    });
  }

  locateOnCanvas(requirementId: string): void {
    this.selectRequirement(requirementId);
    this.selection.switchTab("canvas");
  }

  openInVsCode(featureId: string): void {
    const outline = this.db.readOutline();
    const feature = outline.features.find((item) => item.id === featureId);
    if (!feature) return;
    const absolute = feature.viewPath ?? viewFilePath(this.repoRoot, feature.slug, {});
    this.vscode.open(absolute);
    this.selection.select({ tab: "vscode", featureId });
  }

  copyFeatureMarkdown(featureId: string): string {
    const markdown = featureSpecMarkdown(this.db.readOutline(), featureId);
    this.clipboard.write(markdown);
    this.lastMarkdown = markdown;
    return markdown;
  }

  jumpToConflict(conflict: ConflictItem): void {
    const cellId = conflict.cellIds[0] ?? null;
    const decisionId = conflict.decisionIds[0] ?? null;
    this.focusId = decisionId ?? conflict.id;
    this.selection.select({
      tab: "spec",
      conflictId: conflict.id,
      cellId,
      decisionId,
    });
  }

  render(): string {
    const outline = this.db.readOutline();
    this.visibleIds = [];
    const tokens = THEME[this.theme];
    const query = this.search.trim().toLowerCase();
    const hideWireframes = outline.projectKind === "cli" || outline.features.every((feature) => feature.screens.length === 0);
    const parts = [rootOpen(this.theme, "Spec Browser"), renderConflictStrip(outline.conflicts, tokens)];
    parts.push(
      `<label>Search spec <input data-action="search" value="${escapeHtml(this.search)}" /></label>`,
      `<ul role="tree" aria-label="Spec outline">`,
    );
    if (outline.overview && matches(query, outline.overview.title, outline.overview.text)) {
      parts.push(this.item("system-overview", "System Overview", escapeHtml(outline.overview.text)));
    } else if (query.length === 0) {
      parts.push(this.item("system-overview", "System Overview", outline.overview ? escapeHtml(outline.overview.text) : ""));
    }
    parts.push(this.item("decisions", "Decisions &amp; Chosen For You", this.decisionsHtml(outline, query)));
    parts.push(this.item("features", "Features", this.featuresHtml(outline, query, hideWireframes)));
    parts.push(this.item("rules", "Cross-Cutting Rules (X-01..X-14)", this.rulesHtml(outline, query)));
    parts.push(`</ul></section>`);
    return parts.join("");
  }

  private activate(id: string): void {
    const outline = this.db.readOutline();
    for (const feature of outline.features) {
      if (feature.id === id) {
        this.selection.select({ tab: "spec", featureId: id });
        return;
      }
      if (feature.requirements.some((requirement) => requirement.id === id)) {
        this.selectRequirement(id);
        return;
      }
    }
    if (outline.decisions.some((decision) => decision.id === id)) {
      this.selection.select({ tab: "spec", decisionId: id });
    }
  }

  private decisionsHtml(outline: OutlineSnapshot, query: string): string {
    const rows = outline.decisions.filter((decision) => matches(query, decision.title, decision.text, provenancePill(decision)));
    if (rows.length === 0) return "";
    return `<ul>${rows.map((decision) => this.decisionHtml(decision, outline)).join("")}</ul>`;
  }

  private decisionHtml(decision: OutlineNode, outline: OutlineSnapshot): string {
    const chosen = outline.chosenForYou.some((item) => item.id === decision.id);
    const mustAsk = boolField(decision.fields, "must_ask") ? `<span class="chip">must-ask</span>` : "";
    const link = chosen
      ? `<a href="#decision-${escapeHtml(decision.id)}" data-action="chosen-for-you" data-decision-id="${escapeHtml(decision.id)}">Chosen for you</a>`
      : "";
    return this.item(
      decision.id,
      `${escapeHtml(decision.title)} ${link}`,
      `<p>${escapeHtml(decision.text)}</p><span class="chip" data-provenance="${escapeHtml(provenancePill(decision))}">${escapeHtml(provenancePill(decision))}</span>${mustAsk}`,
    );
  }

  private featuresHtml(outline: OutlineSnapshot, query: string, hideWireframes: boolean): string {
    const blocks = outline.features
      .map((feature) => this.featureHtml(outline, feature, query, hideWireframes))
      .filter((html) => html.length > 0);
    return blocks.join("");
  }

  private featureHtml(outline: OutlineSnapshot, feature: FeatureOutline, query: string, hideWireframes: boolean): string {
    const featureMatches = matches(query, feature.title, feature.id);
    const requirements = feature.requirements.filter((item) => featureMatches || matches(query, item.title, item.text, provenancePill(item)));
    const contracts = feature.contracts.filter((item) => featureMatches || matches(query, item.title, item.text));
    const screens = hideWireframes ? [] : feature.screens.filter((item) => featureMatches || matches(query, item.title, item.text));
    const seams = feature.seams.filter((item) => featureMatches || matches(query, item.title, item.text));
    const research = feature.research.filter((item) => featureMatches || matches(query, item.title, item.text));
    const commands = feature.cliCommands.filter((item) => featureMatches || matches(query, item.title, item.text));
    const exitCodes = feature.exitCodes.filter((item) => featureMatches || matches(query, item.title, item.text));
    const showCli = outline.projectKind === "cli" || commands.length > 0 || exitCodes.length > 0;
    if (
      query.length > 0 &&
      !featureMatches &&
      requirements.length + contracts.length + screens.length + seams.length + research.length + commands.length + exitCodes.length === 0
    ) {
      return "";
    }
    const open = !this.collapsed.has(feature.id);
    const body = open
      ? [
          this.group("EARS Requirements", requirements.map((item) => this.requirementHtml(feature, item)).join("")),
          this.group("Contracts/Schemas", contracts.map((item) => this.item(item.id, escapeHtml(item.title), escapeHtml(item.text))).join("")),
          hideWireframes ? "" : this.group("Screen Specs", screens.map((item) => this.screenHtml(item)).join("")),
          this.group("Seams", seams.map((item) => this.item(item.id, escapeHtml(item.title), escapeHtml(item.text))).join("")),
          this.group("Research Facts", research.map((item) => this.item(item.id, escapeHtml(item.title), escapeHtml(item.text))).join("")),
          showCli ? this.group("CLI Command Specs", commands.map((item) => this.item(item.id, escapeHtml(item.title), escapeHtml(item.text))).join("")) : "",
          showCli ? this.group("Exit-Code Matrix", exitCodes.map((item) => this.item(item.id, escapeHtml(item.title), escapeHtml(item.text))).join("")) : "",
          `<button type="button" data-action="copy-markdown" data-feature-id="${escapeHtml(feature.id)}">Copy Feature Spec Markdown</button>`,
          `<button type="button" data-action="open-vscode" data-feature-id="${escapeHtml(feature.id)}">Open in VS Code (.harness/views/features/${escapeHtml(feature.slug)}.md)</button>`,
        ].join("")
      : "";
    return this.item(feature.id, escapeHtml(feature.title), body, open);
  }

  private requirementHtml(feature: FeatureOutline, requirement: OutlineNode): string {
    const pill = provenancePill(requirement);
    const touches = stringList(requirement.fields, "touches")
      .map((tag) => `<span class="chip" data-touch="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`)
      .join("");
    const body = `<p>${escapeHtml(requirement.text)}</p><span class="chip" data-provenance="${escapeHtml(pill)}">${escapeHtml(pill)}</span>${touches}<button type="button" data-action="locate-canvas" data-requirement-id="${escapeHtml(requirement.id)}">Locate on Canvas</button><button type="button" data-action="open-vscode" data-feature-id="${escapeHtml(feature.id)}">Open in VS Code (.harness/views/features/${escapeHtml(feature.slug)}.md)</button>`;
    return this.item(requirement.id, escapeHtml(requirement.title), body);
  }

  private screenHtml(screen: OutlineNode): string {
    const states = stringList(screen.fields, "states");
    const svg = this.wireframes.render({ id: screen.id, title: screen.title, states }).svg;
    return this.item(screen.id, escapeHtml(screen.title), svg);
  }

  private rulesHtml(outline: OutlineSnapshot, query: string): string {
    const rules = outline.rules.filter((rule) => matches(query, rule.id, rule.title, rule.text));
    return rules.map((rule) => this.item(rule.id, `${escapeHtml(rule.id)} ${escapeHtml(rule.title)}`, escapeHtml(rule.text))).join("");
  }

  private group(title: string, body: string): string {
    if (body.length === 0 && title !== "CLI Command Specs" && title !== "Exit-Code Matrix") return "";
    if (body.length === 0) return "";
    return `<section><h3>${title}</h3><ul>${body}</ul></section>`;
  }

  private item(id: string, titleHtml: string, body: string, expanded = true): string {
    this.visibleIds.push(id);
    const selected =
      this.selection.featureId === id ||
      this.selection.requirementId === id ||
      this.selection.decisionId === id ||
      this.selection.conflictId === id;
    const active = this.focusId === id;
    return `<li role="treeitem" id="node-${escapeHtml(id)}" data-node-id="${escapeHtml(id)}" tabindex="0" aria-expanded="${expanded ? "true" : "false"}"${selected ? ' data-selected="true"' : ""}${active ? ' data-active="true"' : ""}><span>${titleHtml}</span>${body}</li>`;
  }
}

function matches(query: string, ...parts: readonly string[]): boolean {
  if (query.length === 0) return true;
  return parts.some((part) => part.toLowerCase().includes(query));
}
