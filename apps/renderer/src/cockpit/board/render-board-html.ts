import { BOARD_THEMES, themeStyle } from "./board-theme.js";
import type { BoardViewSnapshot, RenderedLane, RenderedRow } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function domId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "-");
  return cleaned.length > 0 ? cleaned : "item";
}

const MODES = [
  ["all", "All"],
  ["active_only", "Active Only"],
  ["needs_attention", "Needs Attention"],
  ["by_feature", "By Feature"],
  ["by_connection", "By Connection"],
] as const;

function renderRow(row: RenderedRow, healthMarkup: ReadonlyMap<string, string>): string {
  if (row.kind === "swimlane") {
    return `<li class="lane-row" style="top:${row.topPx}px;height:${row.heightPx}px">
      <button type="button" data-group-key="${escapeHtml(row.key)}" aria-expanded="${row.collapsed ? "false" : "true"}">
        ${escapeHtml(row.label)} ${escapeHtml(row.summary)}
      </button>
    </li>`;
  }
  const card = row.card;
  const openLabel = `Open ${card.agentFull}, ${card.tier}, ${card.connectionLabel}`;
  const badges = [
    card.subBadgeId
      ? `<span class="badge" data-sub-badge="${escapeHtml(card.subBadgeId)}">${escapeHtml(card.subBadge ?? "")}</span>`
      : "",
    card.holdBadge
      ? `<span class="badge" data-hold="true" title="${escapeHtml(card.holdTitle ?? card.holdBadge)}">${escapeHtml(card.holdBadge)}</span>`
      : "",
    `<span class="quarantine" data-quarantine="${card.quarantined ? "on" : "off"}">Quarantined</span>`,
  ].join("");
  const health = card.health
    .map((slot) => {
      const filled = slot.label !== null;
      const hidden = filled
        ? `<span class="sr-only">${escapeHtml(slot.label ?? "")}</span>`
        : "";
      return `<span class="health-slot" data-health-slot="${slot.kind}" data-filled="${filled ? "true" : "false"}" style="width:${slot.sizePx}px;height:${slot.sizePx}px"${filled ? "" : ' aria-hidden="true"'}>${hidden}</span>`;
    })
    .join("");
  const actions = card.actions
    .map((action) => {
      const inbox =
        action.id === "jump_to_inbox" && card.inboxItemId
          ? ` data-inbox-id="${escapeHtml(card.inboxItemId)}"`
          : "";
      return `<button type="button" data-action="${action.id}" data-task-id="${escapeHtml(card.taskId)}"${inbox} aria-disabled="${action.enabled ? "false" : "true"}" tabindex="${card.selected ? "0" : "-1"}">${escapeHtml(action.label)}</button>`;
    })
    .join("");
  return `<li class="lane-row" style="top:${row.topPx}px;height:${row.heightPx}px">
    <article class="card" data-task-card="true" data-task-id="${escapeHtml(card.taskId)}" data-lane="${card.lane}" data-highlighted="${card.highlighted ? "true" : "false"}" data-selected="${card.selected ? "true" : "false"}" data-card-height="${card.heightPx}" id="board-card-${domId(card.taskId)}">
      <div class="identity">
        <span class="dot" style="background:${card.dotColor}" aria-hidden="true"></span>
        <button type="button" data-action="open-inspector" data-task-id="${escapeHtml(card.taskId)}" aria-label="${escapeHtml(openLabel)}" title="${escapeHtml(card.agentFull)}" tabindex="${card.selected ? "0" : "-1"}">${escapeHtml(card.agentLabel)}</button>
        <span class="tier">${escapeHtml(card.tier)}</span>
      </div>
      <p class="status" title="${escapeHtml(card.statusTitle)}">${escapeHtml(card.statusText)}</p>
      <div class="badges">${badges}</div>
      <div class="health" data-health-row="true">${health}${healthMarkup.get(card.taskId) ?? ""}</div>
      <div class="actions">${actions}</div>
    </article>
  </li>`;
}

function renderLane(lane: RenderedLane, healthMarkup: ReadonlyMap<string, string>): string {
  const listId = `lane-${lane.id}-list`;
  const showList = lane.rows.length > 0;
  const viewportHeight = lane.scrollable
    ? lane.viewportHeightPx
    : Math.max(lane.totalHeightPx, 0);
  const list = showList
    ? `<div class="viewport" style="height:${viewportHeight}px" data-scroll-top="${lane.scrollTop}"${lane.scrollable ? ` tabindex="0" aria-label="${escapeHtml(lane.label)} tasks"` : ""}>
        <ul class="lane-list" id="${listId}" style="height:${lane.totalHeightPx}px">
          ${lane.rows.map((row) => renderRow(row, healthMarkup)).join("")}
        </ul>
      </div>`
    : `<p>None</p>`;
  const doneToggle =
    lane.id === "done"
      ? `<button type="button" data-done-toggle="true" aria-expanded="${lane.collapsed ? "false" : "true"}"${showList ? ` aria-controls="${listId}"` : ""}>${lane.collapsed ? "Expand" : "Collapse"}</button>`
      : "";
  return `<section class="lane" data-lane="${lane.id}" data-density="${lane.density}" data-collapsed="${lane.collapsed ? "true" : "false"}" aria-labelledby="lane-${lane.id}-title">
    <h2 id="lane-${lane.id}-title">${escapeHtml(lane.label)} <span class="count">${lane.count}</span></h2>
    ${doneToggle}
    ${list}
  </section>`;
}

export function renderBoardHtml(
  snapshot: BoardViewSnapshot,
  healthMarkup: ReadonlyMap<string, string> = new Map(),
): string {
  const theme = BOARD_THEMES[snapshot.theme];
  const modes = MODES.map(
    ([id, label]) =>
      `<button type="button" data-mode="${id}" aria-pressed="${snapshot.mode === id ? "true" : "false"}">${label}</button>`,
  ).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Board cockpit</title>
  <style>${themeStyle(theme)}</style>
</head>
<body>
  <main aria-label="Board cockpit" data-board-root="true" data-theme="${snapshot.theme}" data-mounted-cards="${snapshot.visibleCardCount}">
    <a href="#board-lanes">Skip to lanes</a>
    <h1>Board</h1>
    <p class="sr-only">Use arrow keys to move across lanes and cards. Press Enter to open the worker inspector.</p>
    <div class="toolbar" role="toolbar" aria-label="Board filters">
      ${modes}
      <button type="button" data-feature-grouping="true" aria-pressed="${snapshot.featureGrouping ? "true" : "false"}">Feature grouping</button>
      <label>Filter <input id="board-filter" type="search" autocomplete="off" value="${escapeHtml(snapshot.search)}" /></label>
    </div>
    <p class="capacity" data-capacity-header="true">${escapeHtml(snapshot.capacityHeader)}</p>
    <div class="lanes" id="board-lanes">
      ${snapshot.lanes.map((lane) => renderLane(lane, healthMarkup)).join("")}
    </div>
  </main>
</body>
</html>`;
}
