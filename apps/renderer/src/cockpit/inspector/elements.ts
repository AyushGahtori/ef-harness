export interface InspectorElement {
  readonly type: string;
  readonly role: string;
  readonly name: string;
  readonly text: string;
  readonly children: readonly InspectorElement[];
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

export function el(
  type: string,
  name: string,
  text = "",
  children: readonly InspectorElement[] = [],
  props: Readonly<Record<string, string | number | boolean>> = {},
  role = type,
): InspectorElement {
  return { type, role, name, text, children, props };
}

export function collectText(node: InspectorElement): string {
  const parts: string[] = [];
  walk(node, parts);
  return parts.join("\n");
}

export function findAll(
  node: InspectorElement,
  predicate: (candidate: InspectorElement) => boolean,
): InspectorElement[] {
  const out: InspectorElement[] = [];
  const visit = (current: InspectorElement): void => {
    if (predicate(current)) out.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return out;
}

export function findByName(node: InspectorElement, name: string): InspectorElement | undefined {
  return findAll(node, (candidate) => candidate.name === name)[0];
}

function walk(node: InspectorElement, parts: string[]): void {
  if (node.name) parts.push(node.name);
  if (node.text) parts.push(node.text);
  for (const child of node.children) walk(child, parts);
}
