import { LOCAL_PORTS } from "./types.js";

/** Local port of Phase 0 layout templates until Task 094 exports them. */
export const LAYOUT_TEMPLATE_SOURCE = LOCAL_PORTS.layoutTemplates;

export const LAYOUT_TEMPLATES = [
  { id: "app-shell", name: "App shell (nav + header + content)" },
  { id: "page-header", name: "Page header with an actions slot" },
  { id: "list-detail", name: "List / detail" },
  { id: "form-page", name: "Form page" },
  { id: "empty-state", name: "Empty state" },
  { id: "error-state", name: "Error state" },
] as const;

export type LayoutTemplateId = (typeof LAYOUT_TEMPLATES)[number]["id"];

export const SHARED_PRIMITIVES = [
  "AppShell",
  "PageHeader",
  "Button",
  "Card",
  "Input",
  "Table",
  "Dialog",
  "Toast",
  "EmptyState",
  "ErrorState",
  "Form",
  "Nav",
  "Text",
  "Stack",
] as const;

export type SharedPrimitive = (typeof SHARED_PRIMITIVES)[number];

const TEMPLATE_IDS = new Set<string>(LAYOUT_TEMPLATES.map((template) => template.id));
const PRIMITIVE_IDS = new Set<string>(SHARED_PRIMITIVES);

export function isLayoutTemplate(value: string): value is LayoutTemplateId {
  return TEMPLATE_IDS.has(value);
}

export function isSharedPrimitive(value: string): value is SharedPrimitive {
  return PRIMITIVE_IDS.has(value);
}
