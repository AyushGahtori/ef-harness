import { createElement, type CSSProperties, type ReactNode } from "react";

type AttrValue = string | number | boolean | CSSProperties | (() => void) | undefined;

export function h(
  tag: string,
  attrs: Readonly<Record<string, AttrValue>>,
  ...children: readonly ReactNode[]
): ReactNode {
  const props: Record<string, string | number | boolean | CSSProperties | (() => void)> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) props[key] = value;
  }
  return createElement(tag, props, ...children);
}