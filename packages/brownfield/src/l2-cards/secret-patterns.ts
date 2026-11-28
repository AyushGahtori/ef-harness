function re(source: string, flags = "g"): RegExp {
  return new RegExp(source, flags);
}

export function legacySecretPatterns(): readonly RegExp[] {
  const skLive = ["sk", "_live_"].join("");
  const skTest = ["sk", "_test_"].join("");
  const skAnt = ["sk-ant", "-"].join("");
  const ghp = ["ghp", "_"].join("");
  const akia = ["AK", "IA"].join("");
  const beginKey = ["BEGIN ", "PRIVATE KEY"].join("");
  const endKey = ["END ", "PRIVATE KEY"].join("");
  return [
    re(`\\b${skLive}[A-Za-z0-9]+\\b`),
    re(`\\b${skTest}[A-Za-z0-9]+\\b`),
    re(`\\b${skAnt}[A-Za-z0-9-]+\\b`),
    re(`\\b${ghp}[A-Za-z0-9]+\\b`),
    re(`\\b${akia}[0-9A-Z]{16}\\b`),
    re(`-----${beginKey}-----[\\s\\S]*?-----${endKey}-----`),
    re("\\bpostgres(?:ql)?:\\/\\/[^\\s'\"`]+", "gi"),
    re("\\bmongodb(?:\\+srv)?:\\/\\/[^\\s'\"`]+", "gi"),
    re("\\bmysql:\\/\\/[^\\s'\"`]+", "gi"),
  ];
}