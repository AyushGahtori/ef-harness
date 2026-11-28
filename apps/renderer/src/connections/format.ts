export function formatMicroUsd(microUsd: number): string {
  const negative = microUsd < 0;
  const abs = Math.abs(Math.trunc(microUsd));
  const dollars = Math.floor(abs / 1_000_000);
  const cents = Math.floor((abs % 1_000_000) / 10_000);
  const text = `$${dollars}.${String(cents).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

export function formatCountdown(deltaMs: number): string {
  if (deltaMs <= 0) return "reset due";
  const totalMinutes = Math.floor(deltaMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 48) return `resets in ${Math.floor(hours / 24)}d`;
  return `resets in ${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function percentFromPpm(ppm: number): string {
  const basisPoints = Math.round(ppm / 100);
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, "0");
  return `${whole}.${fraction}%`;
}
