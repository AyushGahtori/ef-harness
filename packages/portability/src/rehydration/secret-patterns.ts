function re(source: string, flags = "g"): RegExp {
  return new RegExp(source, flags);
}

export function importSecretPatterns(): readonly RegExp[] {
  const skLive = ["sk", "_live_"].join("");
  const ghp = ["ghp", "_"].join("");
  const akia = ["AK", "IA"].join("");
  return [
    re(`\\b${skLive}[A-Za-z0-9]+\\b`),
    re(`\\b${ghp}[A-Za-z0-9]+\\b`),
    re(`\\b${akia}[0-9A-Z]{16}\\b`),
    re("\\.env\\b"),
  ];
}