export function formatLabel(worker: number, lane: "thinking" | "execution" | "service"): string {
  return `w${worker} ${lane}`;
}

export function banner(workers: number): string {
  return formatLabel(workers, "thinking");
}
