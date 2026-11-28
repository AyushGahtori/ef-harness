import { matrixTitle, STATUS_PRESENTATION } from "./format.js";
import { escapeHtml, rootOpen, THEME } from "./html.js";
import type { CrossTabSelectionContext } from "./selection.js";
import type { CanonicalStateDb } from "./state-db.js";
import type { CanvasTheme, MatrixFillStatus, MatrixRow } from "./types.js";
import { MATRIX_CATALOG } from "./types.js";

const WINDOW = 24;

export class MatrixCoverageExplorer {
  theme: CanvasTheme = "light";
  showRaw = false;
  offset = 0;
  private focusIndex = 0;

  constructor(
    private readonly db: CanonicalStateDb,
    private readonly selection: CrossTabSelectionContext,
  ) {}

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
  }

  setShowRaw(showRaw: boolean): { readonly elapsedMs: number; readonly html: string } {
    const start = performance.now();
    this.showRaw = showRaw;
    this.offset = 0;
    const html = this.render();
    return { elapsedMs: performance.now() - start, html };
  }

  setOffset(offset: number): void {
    this.offset = Math.max(0, offset);
  }

  pressKey(key: string): void {
    if (key === "ArrowDown") this.focusIndex += 1;
    else if (key === "ArrowUp") this.focusIndex = Math.max(0, this.focusIndex - 1);
    else if (key === "PageDown") this.offset += WINDOW;
    else if (key === "PageUp") this.offset = Math.max(0, this.offset - WINDOW);
    else if (key === "Enter") this.showRaw = !this.showRaw;
  }

  render(): string {
    const tokens = THEME[this.theme];
    const raw = this.showRaw ? this.db.readMatrixRawPage(this.offset, WINDOW) : null;
    const collapsed = this.showRaw ? [] : this.db.readMatrixCollapsed();
    const grouped = groupRows(collapsed);
    const parts = [
      rootOpen(this.theme, "Matrix coverage", `data-mode="${this.showRaw ? "raw" : "collapsed"}"`),
      `<button type="button" data-action="toggle-raw">${this.showRaw ? "Show collapsed rules" : "Expand all raw cells"}</button>`,
    ];
    if (!this.showRaw) {
      for (const matrix of MATRIX_CATALOG) {
        const rows = grouped.get(matrix.id);
        if (!rows || rows.length === 0) continue;
        parts.push(
          `<section data-matrix="${matrix.id}" data-collapsed="${rows.length}"><h2>${escapeHtml(matrixTitle(matrix.id))}</h2><table class="num"><thead><tr><th scope="col">Status</th><th scope="col">Rule or exception</th></tr></thead><tbody>`,
        );
        for (const row of rows) parts.push(this.rowHtml(row, tokens.status[row.status]));
        parts.push(`</tbody></table></section>`);
      }
    } else if (raw) {
      const count = Math.min(WINDOW, raw.rows.length);
      parts.push(
        `<div data-mode="raw" data-total="${raw.total}" data-window-start="${this.offset}" data-window-count="${count}"><table class="num"><thead><tr><th scope="col">Status</th><th scope="col">Cell</th></tr></thead><tbody>`,
      );
      raw.rows.forEach((row, index) => {
        const active = index === this.focusIndex ? ' data-active="true"' : "";
        parts.push(this.rowHtml(row, tokens.status[row.status], active));
      });
      parts.push(`</tbody></table></div>`);
    }
    parts.push(`</section>`);
    return parts.join("");
  }

  private rowHtml(row: MatrixRow, color: string, active = ""): string {
    const presentation = STATUS_PRESENTATION[row.status];
    const selected = this.selection.cellId === row.id ? ' data-selected="true"' : "";
    const label = row.recordType === "matrix_cell" ? `${row.axisA} × ${row.axisB} ${row.text}` : row.text || row.title;
    return `<tr data-row-id="${escapeHtml(row.id)}" data-status="${row.status}"${selected}${active}><td><span role="img" aria-label="${escapeHtml(presentation.label)}" style="color:${color}">${presentation.symbol} ${escapeHtml(presentation.label)}</span></td><td>${escapeHtml(label)}</td></tr>`;
  }
}

function groupRows(rows: readonly MatrixRow[]): Map<string, MatrixRow[]> {
  const grouped = new Map<string, MatrixRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.matrixId);
    if (list) list.push(row);
    else grouped.set(row.matrixId, [row]);
  }
  return grouped;
}

export function statusLabel(status: MatrixFillStatus): string {
  return STATUS_PRESENTATION[status].label;
}
