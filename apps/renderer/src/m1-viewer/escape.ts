const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
} as const;

/** Escape text that must never be inserted with innerHTML. */
export function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch as keyof typeof ESCAPES] ?? ch);
}

export function renderDiffText(lines: readonly { readonly kind: string; readonly text: string }[]): string {
  return lines.map((line) => escapeText(line.text)).join("\n");
}
