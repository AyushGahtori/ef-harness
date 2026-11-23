import { renderConflictStrip } from "./conflict-strip.js";
import {
  formatRangeUsd,
  formatUsd,
  PAPERWORK_COMPACT,
  PAPERWORK_LINE,
  PAPERWORK_SEGMENTS,
  provenancePill,
  startBuildBlockReason,
  WAVE_LATER_NOTE,
} from "./format.js";
import { escapeHtml, rootOpen, THEME } from "./html.js";
import { LocalInteractivePlanEditor } from "./plan-math.js";
import type { ChosenForYouOverridePort, InteractivePlanEditorPort, StartBuildPort } from "./ports.js";
import { LocalChosenForYouOverride, LocalStartBuild } from "./ports.js";
import type { CrossTabSelectionContext } from "./selection.js";
import type { CanonicalStateDb } from "./state-db.js";
import type { CanvasTheme, ConflictItem, CrewPreset, PricedLeaf, PlanSnapshot } from "./types.js";
import { PHASE0_STEPS } from "./types.js";

const PRESETS: readonly CrewPreset[] = ["Fastest", "Balanced", "Cheapest"];

export interface PlanTreeOptions {
  readonly editor?: InteractivePlanEditorPort;
  readonly startBuild?: StartBuildPort;
  readonly chosenForYou?: ChosenForYouOverridePort;
}

export class PlanTreeAndPreviewTab {
  theme: CanvasTheme = "light";
  preset: CrewPreset = "Balanced";
  lastRecalcMs = 0;
  lastRoute = "";
  private focusId: string | null = null;
  private visibleIds: string[] = [];

  constructor(
    private readonly db: CanonicalStateDb,
    private readonly selection: CrossTabSelectionContext,
    private readonly editor: InteractivePlanEditorPort = new LocalInteractivePlanEditor(),
    private readonly startBuildPort: StartBuildPort = new LocalStartBuild(),
    private readonly chosenPort: ChosenForYouOverridePort = new LocalChosenForYouOverride(),
  ) {}

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
  }

  switchPreset(preset: CrewPreset): { readonly elapsedMs: number; readonly html: string } {
    const start = performance.now();
    this.preset = preset;
    const snapshot = this.db.readPlan();
    const priced = this.editor.switchPreset(preset, snapshot);
    this.lastRecalcMs = priced.elapsedMs;
    const html = this.renderFrom(snapshot, priced.leaves);
    return { elapsedMs: performance.now() - start, html };
  }

  startBuild(): { readonly started: boolean; readonly reason: string | null } {
    const snapshot = this.db.readPlan();
    if (snapshot.mode !== "first") return { started: false, reason: "Plan Delta" };
    const reason = startBuildBlockReason(snapshot.conflicts.length, snapshot.mustAsk);
    if (reason) return { started: false, reason };
    this.startBuildPort.start();
    return { started: true, reason: null };
  }

  focusBlocker(): void {
    const snapshot = this.db.readPlan();
    const conflict = snapshot.conflicts[0];
    if (conflict) this.jumpToConflict(conflict);
  }

  jumpToConflict(conflict: ConflictItem): void {
    this.focusId = conflict.decisionIds[0] ?? conflict.id;
    this.selection.select({
      tab: "plan",
      conflictId: conflict.id,
      cellId: conflict.cellIds[0] ?? null,
      decisionId: conflict.decisionIds[0] ?? null,
    });
  }

  overrideChosen(decisionId: string): void {
    this.chosenPort.override(decisionId);
    this.selection.select({ tab: "plan", decisionId });
    this.lastRoute = `Task-087:${decisionId}`;
  }

  changeChosen(decisionId: string): void {
    this.selection.select({ tab: "plan", decisionId });
    this.lastRoute = `Task-087:${decisionId}`;
  }

  pressKey(key: string): void {
    const ids = this.visibleIds;
    if (ids.length === 0) return;
    const index = Math.max(0, ids.indexOf(this.focusId ?? ids[0] ?? ""));
    if (key === "ArrowDown") this.focusId = ids[Math.min(ids.length - 1, index + 1)] ?? null;
    else if (key === "ArrowUp") this.focusId = ids[Math.max(0, index - 1)] ?? null;
    else if (key === "Home") this.focusId = ids[0] ?? null;
    else if (key === "End") this.focusId = ids[ids.length - 1] ?? null;
  }

  render(): string {
    const snapshot = this.db.readPlan();
    const priced = this.editor.switchPreset(this.preset, snapshot);
    this.lastRecalcMs = priced.elapsedMs;
    return this.renderFrom(snapshot, priced.leaves);
  }

  private renderFrom(snapshot: PlanSnapshot, leaves: readonly PricedLeaf[]): string {
    this.visibleIds = [];
    const tokens = THEME[this.theme];
    const reason = snapshot.mode === "first" ? startBuildBlockReason(snapshot.conflicts.length, snapshot.mustAsk) : null;
    const parts = [
      rootOpen(this.theme, "Plan tree and preview", `data-plan-mode="${snapshot.mode}" data-preset="${this.preset}"`),
      renderConflictStrip(snapshot.conflicts, tokens),
      `<div role="group" aria-label="Crew preset">${PRESETS.map((preset) => `<button type="button" data-preset="${preset}" aria-pressed="${preset === this.preset ? "true" : "false"}">${preset}</button>`).join("")}</div>`,
      this.paperworkHtml(),
    ];
    if (snapshot.mode === "first") parts.push(this.startHtml(reason));
    else parts.push(`<section aria-label="Plan Delta"><h2>Plan Delta</h2><p>${escapeHtml(snapshot.deltaText)}</p></section>`);
    parts.push(`<section aria-label="Planned Now"><h2>Planned Now</h2>${this.phase0Html(leaves)}${this.wave1Html(leaves)}</section>`);
    parts.push(`<section aria-label="Projected Later"><h2>Projected Later</h2>${this.projectedHtml(snapshot)}</section>`);
    parts.push(`<section aria-label="Chosen for you"><h2>Chosen for you</h2><ul>${snapshot.chosenForYou.map((entry) => this.chosenHtml(entry)).join("")}</ul></section>`);
    parts.push(
      `<section aria-label="Deferred items"><h2>Deferred items</h2><ul>${snapshot.deferred
        .map(
          (item) =>
            `<li data-deferred-id="${escapeHtml(item.id)}">${escapeHtml(item.label)} — ${escapeHtml(item.reason)} Revisit ${escapeHtml(item.revisitWave)}</li>`,
        )
        .join("")}</ul></section>`,
    );
    parts.push(`</section>`);
    return parts.join("");
  }

  private startHtml(reason: string | null): string {
    if (!reason) return `<button type="button" data-action="start-build">Start Build</button>`;
    return `<button type="button" data-action="start-build" disabled aria-disabled="true" aria-describedby="start-build-block">Start Build</button><a id="start-build-block" role="tooltip" data-action="focus-blocker" href="#conflict-blocker">${escapeHtml(reason)}</a>`;
  }

  private paperworkHtml(): string {
    const segments = PAPERWORK_SEGMENTS.map(
      (segment) =>
        `<span class="num" style="display:inline-block;width:${(segment.percent / 20) * 100}%">${segment.percent}%</span>`,
    ).join("");
    return `<div role="img" aria-label="Paperwork envelope &lt;= 20% (${PAPERWORK_COMPACT})" data-paperwork="${PAPERWORK_COMPACT}">${segments}<p>${PAPERWORK_LINE}</p><p>&lt;= 20%</p></div>`;
  }

  private phase0Html(leaves: readonly PricedLeaf[]): string {
    const rows = PHASE0_STEPS.map((step) => {
      const tasks = leaves.filter((leaf) => leaf.band === "phase0" && leaf.step === step);
      const body = tasks.map((leaf) => this.leafHtml(leaf)).join("");
      return `<section data-step="${step}"><h3>${step}</h3>${body}</section>`;
    }).join("");
    return `<section><h3>Phase 0</h3>${rows}</section>`;
  }

  private wave1Html(leaves: readonly PricedLeaf[]): string {
    const tasks = leaves.filter((leaf) => leaf.band === "wave1");
    return `<section><h3>Wave 1</h3>${tasks.map((leaf) => this.leafHtml(leaf)).join("")}</section>`;
  }

  private leafHtml(leaf: PricedLeaf): string {
    this.visibleIds.push(leaf.id);
    const selected = this.selection.featureId === leaf.featureId || this.selection.taskId === leaf.id;
    const active = this.focusId === leaf.id ? ' data-active="true"' : "";
    const scope = leaf.writeScope.map((path) => escapeHtml(path)).join(", ");
    return `<article data-task-id="${escapeHtml(leaf.id)}" data-feature-id="${escapeHtml(leaf.featureId)}" data-cost="${leaf.costMicroUsd}" data-minutes="${leaf.minutes}"${selected ? ' data-selected="true"' : ""}${active} tabindex="0"><h4>${escapeHtml(leaf.title)}</h4><span class="tier-chip">${leaf.chip}</span><p>Write scope ${scope}</p><p class="num">${formatUsd(leaf.costMicroUsd)}</p><p class="num">${leaf.minutes} min</p></article>`;
  }

  private projectedHtml(snapshot: PlanSnapshot): string {
    return snapshot.projected
      .map((wave) => {
        this.visibleIds.push(wave.id);
        const selected = this.selection.featureId === wave.id ? ' data-selected="true"' : "";
        return `<article data-projected-wave="${wave.wave}" data-feature-id="${escapeHtml(wave.id)}"${selected}><h3>Wave ${wave.wave}: ${escapeHtml(wave.title)} — ${wave.taskMin}–${wave.taskMax} tasks, ${formatRangeUsd(wave.costMinMicroUsd, wave.costMaxMicroUsd)}</h3><p>${WAVE_LATER_NOTE}</p></article>`;
      })
      .join("");
  }

  private chosenHtml(entry: import("./types.js").OutlineNode): string {
    this.visibleIds.push(entry.id);
    const selected = this.selection.decisionId === entry.id ? ' data-selected="true"' : "";
    const label = entry.title;
    return `<li data-decision-id="${escapeHtml(entry.id)}"${selected}><span>${escapeHtml(label)}</span><span class="chip" data-provenance="${escapeHtml(provenancePill(entry))}">${escapeHtml(provenancePill(entry))}</span><button type="button" data-action="change" data-decision-id="${escapeHtml(entry.id)}">Change</button><button type="button" data-action="override" data-decision-id="${escapeHtml(entry.id)}">Override</button></li>`;
  }
}
