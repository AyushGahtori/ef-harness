/**
 * DOMPurify 3.4.18 `USE_PROFILES: { svg: true, svgFilters: true }` tag sets.
 * `script`, `foreignObject`, `animate`, and `set` are outside this profile.
 * `use` is outside DOMPurify's profile as well; the sanitizer keeps it only when
 * the href is an in-document fragment, and drops every external `use`.
 */
export const DOMPURIFY_SVG_PROFILE = "dompurify-3.4.18-svg+svgFilters" as const;

export const DOMPURIFY_SVG_TAGS = [
  "svg",
  "a",
  "altglyph",
  "altglyphdef",
  "altglyphitem",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "filter",
  "font",
  "g",
  "glyph",
  "glyphref",
  "hkern",
  "image",
  "line",
  "lineargradient",
  "marker",
  "mask",
  "metadata",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "style",
  "switch",
  "symbol",
  "text",
  "textpath",
  "title",
  "tref",
  "tspan",
  "view",
  "vkern",
] as const;

export const DOMPURIFY_SVG_FILTER_TAGS = [
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
] as const;

const CANONICAL_TAGS = new Map<string, string>();
for (const tag of [...DOMPURIFY_SVG_TAGS, ...DOMPURIFY_SVG_FILTER_TAGS, "use"]) {
  CANONICAL_TAGS.set(tag.toLowerCase(), tag);
}

export function canonicalSvgTag(localName: string): string | null {
  return CANONICAL_TAGS.get(localName.toLowerCase()) ?? null;
}

export const ALLOWED_XMLNS = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/xmlns/",
  "http://www.w3.org/XML/1998/namespace",
]);
