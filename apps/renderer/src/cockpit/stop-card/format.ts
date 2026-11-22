export function formatMicroUsd(units: number): string {
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error("micro-USD must be a non-negative integer");
  }
  let dollars = Math.trunc(units / 1_000_000);
  const micros = units % 1_000_000;
  let cents = Math.trunc((micros + 5_000) / 10_000);
  if (cents >= 100) {
    dollars += Math.trunc(cents / 100);
    cents %= 100;
  }
  return `$${dollars}.${cents.toString().padStart(2, "0")}`;
}

export function formatCountdown(remainingMs: number): string {
  const safe = remainingMs > 0 ? remainingMs : 0;
  const totalMinutes = Math.floor(safe / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function paidSwitchConfirmation(label: string, estimateMicroUsd: number, remainingTasks: number): string {
  const noun = remainingTasks === 1 ? "task" : "tasks";
  return `${label} is pay-per-use (~${formatMicroUsd(estimateMicroUsd)} est. for remaining ${remainingTasks} ${noun}) — Confirm?`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
