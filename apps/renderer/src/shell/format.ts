import type { InboxItem, RailFilter, SpendEntry, SpendState } from "./types.js";

function formatUsd(amount: number, trimWhole: boolean): string {
  const fixed = amount.toFixed(2);
  const body = trimWhole && fixed.endsWith(".00") ? String(Math.trunc(amount)) : fixed;
  return `$${body}`;
}

export function formatSpendEntry(entry: SpendEntry): string {
  if (entry.kind === "api") {
    return `${formatUsd(entry.spentUsd, false)} / ${formatUsd(entry.capUsd, true)}`;
  }
  return `${Math.round(entry.percentOfWindow)}% of ${entry.windowLabel} window`;
}

export function formatSpendLine(entry: SpendEntry): string {
  return `${entry.connectionLabel}: ${formatSpendEntry(entry)}`;
}

export function spendPrimary(spend: SpendState): string {
  return formatSpendEntry(spend.active);
}

export function spendLines(spend: SpendState): readonly string[] {
  const lines = spend.breakdown.map(formatSpendLine);
  const active = formatSpendLine(spend.active);
  return lines.includes(active) ? lines : [active, ...lines];
}

export function visibleInbox(items: readonly InboxItem[], filter: RailFilter): readonly InboxItem[] {
  if (filter === "needs-you") return items.filter((item) => item.bucket === "needs-you");
  if (filter === "chat") return items.filter((item) => item.bucket === "chat");
  return items;
}

export function needsYouCount(items: readonly InboxItem[]): number {
  return items.filter((item) => item.bucket === "needs-you").length;
}

export function unreadActionableCount(items: readonly InboxItem[]): number {
  return items.filter((item) => item.unread && item.bucket !== "fyi").length;
}
