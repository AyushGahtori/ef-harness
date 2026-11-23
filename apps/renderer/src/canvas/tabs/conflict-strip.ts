import { conflictStripText } from "./format.js";
import { escapeHtml, type ThemeTokens } from "./html.js";
import type { ConflictItem } from "./types.js";

export function renderConflictStrip(conflicts: readonly ConflictItem[], tokens: ThemeTokens): string {
  if (conflicts.length === 0) return "";
  const first = conflicts[0];
  if (!first) return "";
  const targets = conflicts
    .map((conflict) => {
      const cells = conflict.cellIds
        .map((id) => `<a id="cell-${escapeHtml(id)}" data-cell-id="${escapeHtml(id)}" href="#cell-${escapeHtml(id)}">${escapeHtml(id)}</a>`)
        .join(" ");
      const decisions = conflict.decisionIds
        .map(
          (id) =>
            `<a id="decision-${escapeHtml(id)}" data-decision-id="${escapeHtml(id)}" href="#decision-${escapeHtml(id)}">${escapeHtml(id)}</a>`,
        )
        .join(" ");
      return `<span id="conflict-${escapeHtml(conflict.id)}" data-conflict-target="${escapeHtml(conflict.id)}">${escapeHtml(conflict.summary)} ${cells} ${decisions}</span>`;
    })
    .join("");
  return `<div role="note" data-conflict-strip="true" style="background:${tokens.stripBg};color:${tokens.stripFg}"><a data-action="jump-conflict" data-conflict-id="${escapeHtml(first.id)}" href="#conflict-${escapeHtml(first.id)}">${escapeHtml(conflictStripText(conflicts.length))}</a>${targets}</div>`;
}
