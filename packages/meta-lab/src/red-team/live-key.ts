export function liveKeyPrefix(): string {
  return ["sk", "_live_"].join("");
}

export function previewDecision(token: string): "refused" | "allowed" {
  if (token.startsWith(liveKeyPrefix())) return "refused";
  return "allowed";
}
