import { describe, expect, it } from "vitest";
import { BrandAssetSanitizer } from "../../src/assets/index.js";

const sanitizer = new BrandAssetSanitizer();

describe("BrandAssetSanitizer.sanitizeSvg", () => {
  it("strips script and external image refs and keeps the vector path", () => {
    const dirty = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
      `<title>Logo</title>`,
      `<script>alert(1)</script>`,
      `<image href="https://tracker.evil/px.png"/>`,
      `<path d="M0 0h10v10z" fill="#112233"/>`,
      `</svg>`,
    ].join("");
    const clean = sanitizer.sanitizeSvg(dirty);
    expect(clean.removedElementsLog).toBe("SanitizedSvgRemovedElements: ['script', 'external-image']");
    expect(clean.svg).not.toContain("<script");
    expect(clean.svg).not.toContain("tracker.evil");
    expect(clean.svg).not.toContain("https://tracker");
    expect(clean.svg).toContain(`<path`);
    expect(clean.svg).toContain(`d="M0 0h10v10z"`);
    expect(clean.svg).toContain(`viewBox="0 0 32 32"`);
    expect(clean.svg).toContain("<title>Logo</title>");
    expect(clean.svg).toContain("http://www.w3.org/2000/svg");
    expect(clean.width).toBe(32);
    expect(clean.height).toBe(32);
    expect(clean.dominantColorsHex).toContain("#112233");
  });

  it("strips foreignObject, onload, javascript URIs, external use, and @import", () => {
    const dirty = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">`,
      `<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>`,
      `<rect width="10" height="10" onload="alert(1)" fill="#000000"/>`,
      `<a href="javascript:alert(1)"><path d="M1 1h1"/></a>`,
      `<use href="https://tracker.evil/sprite.svg#a"/>`,
      `<use href="#mark"/>`,
      `<style>@import url(https://tracker.evil/x.css); .a{fill:#fff}</style>`,
      `</svg>`,
    ].join("");
    const clean = sanitizer.sanitizeSvg(dirty);
    expect(clean.svg).not.toContain("foreignObject");
    expect(clean.svg).not.toContain("onload");
    expect(clean.svg).not.toContain("javascript:");
    expect(clean.svg).not.toContain("tracker.evil");
    expect(clean.svg).toContain(`href="#mark"`);
    expect(clean.svg).toContain(`d="M1 1h1"`);
    expect(clean.removed).toEqual(expect.arrayContaining([
      "foreignObject",
      "onload",
      "javascript:",
      "external-use",
      "external-import",
    ]));
  });

  it("drops malformed entities and doctype expansion without keeping the bad token", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><title>A&notanentity;B</title><path d="M0 0h1"/></svg>`;
    const clean = sanitizer.sanitizeSvg(dirty);
    expect(clean.svg).toContain("<title>AB</title>");
    expect(clean.svg).not.toContain("notanentity");
    expect(clean.removed).toContain("malformed-entity");
    const withDoctype = `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h1"/></svg>`;
    const stripped = sanitizer.sanitizeSvg(withDoctype);
    expect(stripped.svg).not.toContain("DOCTYPE");
    expect(stripped.svg).not.toContain("ENTITY");
    expect(stripped.svg).toContain("<path");
  });
});
