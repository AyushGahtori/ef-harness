import type { AxeReport, AxeViolation, VChild, VNode, VProps } from "./types.js";

export function h(type: string, props: VProps, children: readonly VChild[] = []): VNode {
  return { type, props, children };
}

export function textContent(node: VChild): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => textContent(child)).join(" ");
}

export function countNodes(node: VNode, predicate: (candidate: VNode) => boolean): number {
  const self = predicate(node) ? 1 : 0;
  return node.children.reduce((sum, child) => {
    if (typeof child === "string") return sum;
    return sum + countNodes(child, predicate);
  }, self);
}

export function runAxeCoreAudit(root: VNode): AxeReport {
  const violations: AxeViolation[] = [];
  const seen = new Set<string>();
  walk(root, false, violations, seen);
  return {
    violations,
    seriousOrCritical: violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  };
}

function walk(
  node: VNode,
  parentInteractive: boolean,
  violations: AxeViolation[],
  seen: Set<string>,
): void {
  if (node.props.id !== undefined) {
    if (seen.has(node.props.id)) {
      violations.push({
        id: "duplicate-id",
        impact: "serious",
        message: `Duplicate id ${node.props.id}`,
      });
    }
    seen.add(node.props.id);
  }
  const dialog = node.props.role === "dialog" || node.props.role === "alertdialog";
  if (dialog && accessibleName(node).trim().length === 0) {
    violations.push({
      id: "aria-dialog-name",
      impact: "serious",
      message: "Dialog is missing an accessible name",
    });
  }
  const interactive = isInteractive(node);
  if (interactive && parentInteractive) {
    violations.push({
      id: "nested-interactive",
      impact: "serious",
      message: `${node.type} is nested inside another interactive control`,
    });
  }
  if (node.type === "button" && accessibleName(node).trim().length === 0) {
    violations.push({
      id: "button-name",
      impact: "critical",
      message: "Button is missing an accessible name",
    });
  }
  if (node.type === "a") {
    if (node.props.href === undefined || node.props.href.length === 0) {
      violations.push({
        id: "link-name",
        impact: "serious",
        message: "Link is missing an href",
      });
    }
    if (accessibleName(node).trim().length === 0) {
      violations.push({
        id: "link-name",
        impact: "serious",
        message: "Link is missing an accessible name",
      });
    }
  }
  if (node.type === "input" && accessibleName(node).trim().length === 0) {
    violations.push({
      id: "label",
      impact: "critical",
      message: "Input is missing a label",
    });
  }
  if (node.type === "img" && accessibleName(node).trim().length === 0) {
    violations.push({
      id: "image-alt",
      impact: "critical",
      message: "Image is missing alt text",
    });
  }
  if (node.props.fg !== undefined && node.props.bg !== undefined) {
    const ratio = contrastRatio(node.props.fg, node.props.bg);
    if (ratio < 4.5) {
      violations.push({
        id: "color-contrast",
        impact: "serious",
        message: `Contrast ${ratio.toFixed(2)} is below 4.5:1`,
      });
    }
  }
  if (interactive && node.props.tabIndex !== undefined && node.props.tabIndex < 0) {
    violations.push({
      id: "keyboard-access",
      impact: "serious",
      message: "Interactive control is removed from the keyboard order",
    });
  }
  if (node.props.minTargetPx !== undefined && node.props.minTargetPx < 24) {
    violations.push({
      id: "target-size",
      impact: "serious",
      message: "Interactive target is smaller than 24 pixels",
    });
  }
  for (const child of node.children) {
    if (typeof child !== "string") walk(child, interactive, violations, seen);
  }
}

function isInteractive(node: VNode): boolean {
  if (node.type === "button" || node.type === "a" || node.type === "input") return true;
  return node.props.tabIndex !== undefined && node.props.tabIndex >= 0;
}

function accessibleName(node: VNode): string {
  if (node.props.ariaLabel !== undefined && node.props.ariaLabel.length > 0) return node.props.ariaLabel;
  if (node.props.alt !== undefined && node.props.alt.length > 0) return node.props.alt;
  return textContent(node);
}

function contrastRatio(foreground: string, background: string): number {
  const left = relativeLuminance(foreground);
  const right = relativeLuminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function parseHex(input: string): { readonly r: number; readonly g: number; readonly b: number } {
  const hex = input.replace("#", "");
  const expanded = hex.length === 3 ? [...hex].map((char) => `${char}${char}`).join("") : hex;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}
