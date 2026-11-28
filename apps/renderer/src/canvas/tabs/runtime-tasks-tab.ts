import { formatElapsed, formatUsd, formatWindow, tierChip, normalizeLevel, waveLabel } from "./format.js";
import { escapeHtml, rootOpen } from "./html.js";
import type { WorkerInspectorPort } from "./ports.js";
import { LocalWorkerInspector } from "./ports.js";
import type { CrossTabSelectionContext } from "./selection.js";
import type { CanonicalStateDb } from "./state-db.js";
import type { CanvasTheme, RuntimeRow, RuntimeSortKey } from "./types.js";

const COLUMNS: readonly { readonly key: RuntimeSortKey; readonly label: string }[] = [
  { key: "agent", label: "AgentID · Task" },
  { key: "feature", label: "Feature" },
  { key: "wave", label: "Wave" },
  { key: "lane", label: "Lane/Status" },
  { key: "tier", label: "Tier/Model" },
  { key: "retries", label: "Retries" },
  { key: "elapsed", label: "Elapsed" },
  { key: "cost", label: "Cost/Window" },
  { key: "sha", label: "Merge SHA" },
];

const WINDOW = 24;

export class RuntimeTasksTableTab {
  theme: CanvasTheme = "light";
  sort: RuntimeSortKey = "agent";
  direction: "asc" | "desc" = "asc";
  filter = "";
  offset = 0;
  focusIndex = 0;
  inspectorTask: string | null = null;
  readonly windowSize = WINDOW;

  constructor(
    private readonly db: CanonicalStateDb,
    private readonly selection: CrossTabSelectionContext,
    private readonly inspector: WorkerInspectorPort = new LocalWorkerInspector(),
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
  }

  setSort(key: RuntimeSortKey): void {
    if (this.sort === key) this.direction = this.direction === "asc" ? "desc" : "asc";
    else {
      this.sort = key;
      this.direction = "asc";
    }
    this.offset = 0;
  }

  setFilter(filter: string): void {
    this.filter = filter;
    this.offset = 0;
    this.focusIndex = 0;
  }

  setOffset(offset: number): void {
    this.offset = Math.max(0, offset);
  }

  sortFilterAndRender(sort: RuntimeSortKey, filter: string): { readonly elapsedMs: number; readonly html: string } {
    const start = performance.now();
    this.sort = sort;
    this.direction = "asc";
    this.filter = filter;
    this.offset = 0;
    const html = this.render();
    return { elapsedMs: performance.now() - start, html };
  }

  pressKey(key: string): void {
    if (key === "ArrowDown") this.focusIndex += 1;
    else if (key === "ArrowUp") this.focusIndex = Math.max(0, this.focusIndex - 1);
    else if (key === "PageDown") this.offset += WINDOW;
    else if (key === "PageUp") this.offset = Math.max(0, this.offset - WINDOW);
    else if (key === "Home") this.focusIndex = 0;
    else if (key === "End") this.focusIndex = WINDOW - 1;
    else if (key === "Enter") this.activateFocused();
  }

  activateFocused(): void {
    const page = this.db.readRuntimePage(this.query());
    const row = page.rows[Math.min(this.focusIndex, Math.max(0, page.rows.length - 1))];
    if (row) this.activateRow(row.taskId);
  }

  activateRow(taskId: string): void {
    const node = this.db.getNode(taskId);
    this.inspectorTask = taskId;
    this.selection.select({ tab: "board", taskId, featureId: node?.feature ?? null });
    void this.inspector.show({ taskId, host: "collapsible-shell" });
  }

  render(): string {
    const page = this.db.readRuntimePage(this.query());
    if (this.focusIndex >= page.rows.length) this.focusIndex = Math.max(0, page.rows.length - 1);
    const parts = [
      rootOpen(
        this.theme,
        "Runtime tasks",
        `data-total="${page.total}" data-window-start="${this.offset}" data-window-count="${page.rows.length}"`,
      ),
      `<label>Filter tasks <input data-action="filter" value="${escapeHtml(this.filter)}" /></label>`,
      `<table class="num"><thead><tr>`,
    ];
    for (const column of COLUMNS) {
      const aria = this.sort === column.key ? (this.direction === "asc" ? "ascending" : "descending") : "none";
      parts.push(
        `<th scope="col" aria-sort="${aria}"><button type="button" data-sort="${column.key}">${escapeHtml(column.label)}</button></th>`,
      );
    }
    parts.push(`</tr></thead><tbody>`);
    page.rows.forEach((row, index) => parts.push(this.rowHtml(row, index)));
    parts.push(`</tbody></table>`);
    if (this.inspectorTask) {
      parts.push(`<p data-inspector-task="${escapeHtml(this.inspectorTask)}">Worker inspector open</p>`);
    }
    parts.push(`</section>`);
    return parts.join("");
  }

  private query() {
    return {
      sort: this.sort,
      direction: this.direction,
      filter: this.filter,
      offset: this.offset,
      limit: WINDOW,
      nowMs: this.nowMs(),
    };
  }

  private rowHtml(row: RuntimeRow, index: number): string {
    const selected = this.selection.taskId === row.taskId || this.selection.featureId === row.featureId;
    const active = index === this.focusIndex;
    const windowText = formatWindow(row.windowUnits);
    const cost = windowText.length > 0 ? `${formatUsd(row.costMicroUsd)} · ${windowText}` : formatUsd(row.costMicroUsd);
    const tier = `${tierChip(normalizeLevel(row.tier))} / ${row.model}`;
    return `<tr data-task-id="${escapeHtml(row.taskId)}" data-feature-id="${escapeHtml(row.featureId)}" tabindex="0"${selected ? ' data-selected="true"' : ""}${active ? ' data-active="true"' : ""}><td>${escapeHtml(row.agentId)} · ${escapeHtml(row.title)}</td><td>${escapeHtml(row.featureTitle)}</td><td>${escapeHtml(waveLabel(row.wave))}</td><td>${escapeHtml(row.lane)}</td><td>${escapeHtml(tier)}</td><td>${row.retries}</td><td>${escapeHtml(formatElapsed(row.elapsedMs))}</td><td>${escapeHtml(cost)}</td><td>${escapeHtml(row.mergeSha)}</td></tr>`;
  }
}
