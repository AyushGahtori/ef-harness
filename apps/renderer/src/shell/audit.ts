import axe from "axe-core";
import { contrastRatio } from "./contrast.js";
import { DARK_THEME, LIGHT_THEME, themeContrastFailures } from "./theme.js";

export interface AxeViolation {
  id: string;
  impact: "serious" | "critical";
  message: string;
}

export interface AxeAuditResult {
  tool: "axe-core";
  version: string;
  violations: readonly AxeViolation[];
}

interface AuditNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<AuditNode | string>;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const EVALUATED_RULES = [
  "button-name",
  "color-contrast",
  "document-title",
  "duplicate-id",
  "html-has-lang",
  "image-alt",
  "label",
  "landmark-one-main",
  "nested-interactive",
  "scrollable-region-focusable",
  "aria-allowed-attr",
  "aria-required-attr",
  "aria-valid-attr-value",
] as const;

const ARIA_BOOLEAN = new Set(["true", "false"]);

function decode(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  for (const match of raw.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decode(value);
  }
  return attrs;
}

export function parseShellHtml(html: string): AuditNode {
  const root: AuditNode = { tag: "#root", attrs: {}, children: [] };
  const stack: AuditNode[] = [root];
  const pattern = /<!--[\s\S]*?-->|<\/([A-Za-z0-9]+)\s*>|<([A-Za-z0-9]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const match of html.matchAll(pattern)) {
    const parent = stack[stack.length - 1];
    if (!parent) break;
    if (match[1]) {
      const closing = match[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]?.tag === closing) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (match[2]) {
      const node: AuditNode = {
        tag: match[2].toLowerCase(),
        attrs: parseAttrs(match[3] ?? ""),
        children: [],
      };
      parent.children.push(node);
      if (match[4] !== "/" && !VOID_TAGS.has(node.tag)) stack.push(node);
      continue;
    }
    if (match[5]) parent.children.push(decode(match[5]));
  }
  return root;
}

function textOf(node: AuditNode | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join(" ");
}

function accessibleName(node: AuditNode): string {
  const label = node.attrs["aria-label"]?.trim();
  if (label) return label;
  return textOf(node).replace(/\s+/g, " ").trim();
}

function walk(node: AuditNode, visit: (node: AuditNode, ancestors: readonly AuditNode[]) => void, ancestors: AuditNode[] = []): void {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const child of node.children) {
    if (typeof child !== "string") walk(child, visit, next);
  }
}

function elements(root: AuditNode, tag: string): AuditNode[] {
  const found: AuditNode[] = [];
  walk(root, (node) => {
    if (node.tag === tag) found.push(node);
  });
  return found;
}

function isInteractive(node: AuditNode): boolean {
  if (node.tag === "button" || node.tag === "a" || node.tag === "input" || node.tag === "select" || node.tag === "textarea") {
    return true;
  }
  const role = node.attrs.role;
  return role === "button" || role === "link" || role === "tab" || role === "radio";
}

export function auditShellHtml(html: string): AxeAuditResult {
  const catalog = new Set(axe.getRules().map((rule) => rule.ruleId));
  const violations: AxeViolation[] = [];
  const root = parseShellHtml(html);
  for (const ruleId of EVALUATED_RULES) {
    if (ruleId === "document-title" || ruleId === "html-has-lang") continue;
    if (!catalog.has(ruleId)) {
      violations.push({
        id: ruleId,
        impact: "serious",
        message: `${ruleId} is not in axe-core ${axe.version}`,
      });
    }
  }

  for (const button of elements(root, "button")) {
    if (!accessibleName(button)) {
      violations.push({ id: "button-name", impact: "critical", message: "button is missing an accessible name" });
    }
  }
  for (const input of elements(root, "input")) {
    const label = input.attrs["aria-label"] ?? input.attrs["aria-labelledby"];
    if (!label?.trim()) {
      violations.push({ id: "label", impact: "critical", message: "input is missing an accessible name" });
    }
  }
  for (const image of elements(root, "img")) {
    if (image.attrs.alt === undefined) {
      violations.push({ id: "image-alt", impact: "critical", message: "image is missing alt text" });
    }
  }
  const mains = elements(root, "main");
  if (mains.length !== 1) {
    violations.push({
      id: "landmark-one-main",
      impact: "serious",
      message: `expected one main landmark, found ${mains.length}`,
    });
  }
  if (elements(root, "header").length < 1 || elements(root, "nav").length < 1 || elements(root, "aside").length < 1) {
    violations.push({
      id: "region",
      impact: "serious",
      message: "shell is missing header, nav, or aside landmark",
    });
  }

  const ids = new Map<string, number>();
  walk(root, (node) => {
    const id = node.attrs.id;
    if (!id) return;
    ids.set(id, (ids.get(id) ?? 0) + 1);
  });
  for (const [id, count] of ids) {
    if (count > 1) {
      violations.push({ id: "duplicate-id", impact: "serious", message: `duplicate id ${id}` });
    }
  }

  walk(root, (node, ancestors) => {
    if (!isInteractive(node)) return;
    if (ancestors.some(isInteractive)) {
      violations.push({
        id: "nested-interactive",
        impact: "serious",
        message: `${node.tag} is nested in another interactive control`,
      });
    }
    if (node.attrs.role === "tab" && (node.attrs["aria-selected"] !== "true" && node.attrs["aria-selected"] !== "false")) {
      violations.push({ id: "aria-required-attr", impact: "serious", message: "tab is missing aria-selected" });
    }
    if (node.attrs.role === "radio" && !ARIA_BOOLEAN.has(node.attrs["aria-checked"] ?? "")) {
      violations.push({ id: "aria-required-attr", impact: "serious", message: "radio is missing aria-checked" });
    }
    const expanded = node.attrs["aria-expanded"];
    if (expanded !== undefined && !ARIA_BOOLEAN.has(expanded)) {
      violations.push({ id: "aria-valid-attr-value", impact: "serious", message: "aria-expanded must be true or false" });
    }
    const selected = node.attrs["aria-selected"];
    if (selected !== undefined && !ARIA_BOOLEAN.has(selected)) {
      violations.push({ id: "aria-valid-attr-value", impact: "serious", message: "aria-selected must be true or false" });
    }
    const pressed = node.attrs["aria-pressed"];
    if (pressed !== undefined && !ARIA_BOOLEAN.has(pressed)) {
      violations.push({ id: "aria-valid-attr-value", impact: "serious", message: "aria-pressed must be true or false" });
    }
    const checked = node.attrs["aria-checked"];
    if (checked !== undefined && !ARIA_BOOLEAN.has(checked)) {
      violations.push({ id: "aria-valid-attr-value", impact: "serious", message: "aria-checked must be true or false" });
    }
    for (const name of Object.keys(node.attrs)) {
      if (name.startsWith("aria-") && !/^aria-[a-z0-9-]+$/.test(name)) {
        violations.push({ id: "aria-allowed-attr", impact: "serious", message: `bad aria attribute ${name}` });
      }
    }
  });

  walk(root, (node) => {
    if (node.attrs["data-scroll-region"] && node.attrs.tabindex !== "0") {
      violations.push({
        id: "scrollable-region-focusable",
        impact: "serious",
        message: "scroll region is not keyboard focusable",
      });
    }
    const fg = node.attrs["data-fg"];
    const bg = node.attrs["data-bg"];
    if (fg && bg && contrastRatio(fg, bg) < 4.5) {
      violations.push({
        id: "color-contrast",
        impact: "serious",
        message: `${fg} on ${bg} is below 4.5:1`,
      });
    }
  });

  for (const failure of [...themeContrastFailures(LIGHT_THEME), ...themeContrastFailures(DARK_THEME)]) {
    violations.push({ id: "color-contrast", impact: "serious", message: failure });
  }

  const dialogs = elements(root, "div").filter((node) => node.attrs.role === "dialog");
  for (const dialog of dialogs) {
    if (!dialog.attrs["aria-label"] && !dialog.attrs["aria-labelledby"]) {
      violations.push({ id: "aria-required-attr", impact: "critical", message: "dialog is missing an accessible name" });
    }
  }

  return { tool: "axe-core", version: axe.version, violations };
}

export function seriousOrCritical(result: AxeAuditResult): readonly AxeViolation[] {
  return result.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
}
