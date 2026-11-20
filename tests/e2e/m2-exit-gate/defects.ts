export function stripMarkedBlock(source: string, marker: string): string {
  const pattern = new RegExp(`[ \\t]*\\/\\/ ${marker}:start[\\s\\S]*?\\/\\/ ${marker}:end\\r?\\n`, "g");
  const next = source.replace(pattern, "");
  if (next === source) throw new Error(`missing ${marker} block`);
  return next;
}

export function stripCutoffGuard(source: string): string {
  const next = stripMarkedBlock(source, "cutoff-guard");
  if (next.includes("Orders close at 11:00 AM.")) throw new Error("server cutoff guard is still present");
  return next;
}

export function stripExactTotals(source: string): string {
  const next = source.replace(
    /[ \t]*\/\/ totals-format:start[\s\S]*?\/\/ totals-format:end\r?\n/,
    "  lines.push(\"Soup × 99\");\n",
  );
  if (next === source) throw new Error("missing totals block");
  return next;
}
