import { xmlEscape } from "./canonical.js";
import { walkComponents } from "./screen-spec.js";
import type { ComponentNode, OverflowFlag, ScreenSpec, WireframePair, WireframeView } from "./types.js";

export const WIREFRAME_VIEWPORTS = { desktop: 1440, mobile: 375 } as const;

const PAD = 16;
const CHAR_PX = 8;
const COL_MIN = { desktop: 96, mobile: 72 } as const;

export class LowFiWireframeRenderer {
  render(spec: ScreenSpec): WireframePair {
    return {
      screenId: spec.id,
      desktop: renderViewport(spec, "desktop", WIREFRAME_VIEWPORTS.desktop),
      mobile: renderViewport(spec, "mobile", WIREFRAME_VIEWPORTS.mobile),
    };
  }
}

function renderViewport(
  spec: ScreenSpec,
  viewport: "desktop" | "mobile",
  width: 1440 | 375,
): WireframeView {
  const overflow = overflowFlags(spec, viewport, width);
  return {
    viewport,
    widthPx: width,
    svg: renderSvg(spec, viewport, width, overflow),
    ascii: renderAscii(spec, viewport, width, overflow),
    overflow,
  };
}

function overflowFlags(
  spec: ScreenSpec,
  viewport: "desktop" | "mobile",
  width: 1440 | 375,
): OverflowFlag[] {
  const content = width - PAD * 2;
  const flags: OverflowFlag[] = [];
  let columns = 0;
  walkComponents(spec.components, (node) => {
    if (node.primitive === "Table" && node.columns && node.columns.length > columns) {
      columns = node.columns.length;
    }
  });
  if (columns > 0 && columns * COL_MIN[viewport] > content) {
    flags.push({
      code: "horizontal_overflow",
      viewport,
      widthPx: width,
      reason: "table_columns",
      detail: `${columns} table columns at ${width}px`,
    });
  }
  const seen = new Set<string>();
  for (const text of labelTexts(spec)) {
    if (seen.has(text)) continue;
    seen.add(text);
    if (text.length * CHAR_PX > content) {
      flags.push({
        code: "horizontal_overflow",
        viewport,
        widthPx: width,
        reason: "label_text",
        detail: `label exceeds ${width}px`,
      });
    }
  }
  return flags;
}

function labelTexts(spec: ScreenSpec): string[] {
  const texts: string[] = [];
  walkComponents(spec.components, (node) => {
    if (node.label) texts.push(node.label);
  });
  for (const label of spec.labels) texts.push(label.text);
  return texts;
}

function renderAscii(
  spec: ScreenSpec,
  viewport: "desktop" | "mobile",
  width: number,
  overflow: readonly OverflowFlag[],
): string {
  const layout = viewport === "mobile" || spec.templateId !== "list-detail" ? "stack" : "columns";
  const lines = [
    `+ ${spec.slug} ${viewport} ${width}px`,
    `| header | ${screenTitle(spec)} | ${firstButton(spec)?.label ?? "-"}`,
    `| main | ${layout} | ${summarize(spec)}`,
  ];
  for (const state of spec.states) {
    lines.push(`| state ${state} | ${stateCopy(spec, state)}`);
  }
  for (const flag of overflow) {
    lines.push(`| overflow ${flag.reason} | ${flag.detail}`);
  }
  lines.push("+");
  return lines.join("\n");
}

function renderSvg(
  spec: ScreenSpec,
  viewport: "desktop" | "mobile",
  width: number,
  overflow: readonly OverflowFlag[],
): string {
  const layout = viewport === "mobile" || spec.templateId !== "list-detail" ? "stack" : "columns";
  const lines: string[] = [];
  let y = 24;
  lines.push(`  <g data-region="header">`);
  lines.push(`    <text data-role="title" x="16" y="${y}">${xmlEscape(screenTitle(spec))}</text>`);
  y += 24;
  lines.push(
    `    <text data-role="primary-action" x="16" y="${y}">${xmlEscape(firstButton(spec)?.label ?? "-")}</text>`,
  );
  lines.push(`  </g>`);
  y += 24;
  lines.push(`  <g data-region="main" data-layout="${layout}">`);
  lines.push(`    <text data-role="hierarchy" x="16" y="${y}">${xmlEscape(summarize(spec))}</text>`);
  lines.push(`  </g>`);
  for (const state of spec.states) {
    y += 24;
    lines.push(`  <g data-state="${xmlEscape(state)}">`);
    lines.push(`    <text x="16" y="${y}">${xmlEscape(stateCopy(spec, state))}</text>`);
    lines.push(`  </g>`);
  }
  for (const flag of overflow) {
    y += 24;
    lines.push(`  <g data-overflow="${flag.reason}" data-viewport="${viewport}">`);
    lines.push(`    <text x="16" y="${y}">${xmlEscape(flag.detail)}</text>`);
    lines.push(`  </g>`);
  }
  const height = y + 24;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-screen="${xmlEscape(spec.slug)}" data-viewport="${viewport}">`,
    ...lines,
    `</svg>`,
  ].join("\n");
}

function screenTitle(spec: ScreenSpec): string {
  return spec.labels.find((label) => label.id === "title")?.text ?? spec.title;
}

function firstButton(spec: ScreenSpec): ComponentNode | undefined {
  let found: ComponentNode | undefined;
  walkComponents(spec.components, (node) => {
    if (!found && node.primitive === "Button") found = node;
  });
  return found;
}

function summarize(spec: ScreenSpec): string {
  return spec.components.map(summarizeNode).join(" | ");
}

function summarizeNode(node: ComponentNode): string {
  const own =
    node.primitive === "Table" && node.columns
      ? `Table:${node.columns.join(",")}`
      : node.label
        ? `${node.primitive}:${node.label}`
        : node.primitive;
  if (!node.children || node.children.length === 0) return own;
  return `${own} > ${node.children.map(summarizeNode).join(" > ")}`;
}

function stateCopy(spec: ScreenSpec, state: string): string {
  const label = spec.labels.find((item) => item.id === state);
  if (label) return label.text;
  const primitive = state === "empty" ? "EmptyState" : state === "error" ? "ErrorState" : undefined;
  if (primitive) {
    let found: ComponentNode | undefined;
    walkComponents(spec.components, (node) => {
      if (!found && node.primitive === primitive) found = node;
    });
    if (found?.label) return found.label;
  }
  return state;
}
