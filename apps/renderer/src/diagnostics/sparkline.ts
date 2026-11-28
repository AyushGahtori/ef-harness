import type { NamedSparkline } from "./model.js";
import type { ThemePalette } from "./theme.js";

export function renderSparkline(series: NamedSparkline, colors: ThemePalette): string {
  const titleId = `${series.id}-title`;
  const descId = `${series.id}-desc`;
  const summaryId = `${series.id}-summary`;
  const summary = `Minimum ${formatNumber(series.min)} ${series.unit}, maximum ${formatNumber(series.max)} ${series.unit}, latest ${formatNumber(series.latest)} ${series.unit}.`;
  const points = polyline(series);
  return [
    `<figure id="spark-${escapeHtml(series.id)}" style="background-color:${colors.background};color:${colors.text};margin:0 0 16px">`,
    `<svg role="img" aria-labelledby="${titleId} ${descId}" viewBox="0 0 240 48" width="240" height="48" style="background-color:${colors.background}">`,
    `<title id="${titleId}">${escapeHtml(series.label)}, last 24 hours</title>`,
    `<desc id="${descId}">${escapeHtml(summary)}</desc>`,
    `<polyline fill="none" stroke="${colors.stroke}" stroke-width="2" points="${points}"></polyline>`,
    `</svg>`,
    `<p id="${summaryId}" class="tabular-nums" style="background-color:${colors.background};color:${colors.text};font-variant-numeric:tabular-nums;margin:4px 0 0">${escapeHtml(series.label)}: ${escapeHtml(summary)}</p>`,
    `</figure>`,
  ].join("");
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function polyline(series: NamedSparkline): string {
  const values = series.points.map((point) => point.value);
  if (values.length === 0) return "0,24 240,24";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 120 : (index / (values.length - 1)) * 240;
      const y = 44 - ((value - min) / span) * 40;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
