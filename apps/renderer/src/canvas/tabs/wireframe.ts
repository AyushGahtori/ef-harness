import { escapeHtml } from "./html.js";
import type { LowFiWireframeRendererPort, ScreenSpecInput } from "./ports.js";

export class LocalLowFiWireframeRenderer implements LowFiWireframeRendererPort {
  render(spec: ScreenSpecInput): { readonly svg: string } {
    const rows = spec.states
      .map((state, index) => `<text x="24" y="${64 + index * 28}" font-size="16">${escapeHtml(state)}</text>`)
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="220" role="img" aria-label="${escapeHtml(spec.title)} low-fi wireframe"><rect width="1440" height="220" fill="#F7F7F7" stroke="#222"/><text x="24" y="32" font-size="18">${escapeHtml(spec.title)}</text>${rows}</svg>`;
    return { svg };
  }
}
