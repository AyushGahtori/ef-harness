import { describe, expect, it } from "vitest";
import { detectPageVersion } from "../../src/doc-fetcher/index.js";

describe("detectPageVersion", () => {
  it("reads /v15/ and /docs/5.2/ from the URL", () => {
    expect(detectPageVersion({ url: "https://example.com/v15/getting-started" })).toBe("15");
    expect(detectPageVersion({ url: "https://example.com/docs/5.2/guide" })).toBe("5.2");
  });

  it("reads the selected version-switcher option", () => {
    const html = `<select id="version-switcher" class="version-switcher">
      <option value="12">12</option>
      <option value="15.4" selected>15.4</option>
    </select>`;
    expect(detectPageVersion({ html })).toBe("15.4");
  });

  it("reads a current link inside a version switcher", () => {
    const html = `<div class="version-switcher">
      <a href="/v12/">12</a>
      <a href="/v13/" aria-current="page">13</a>
    </div>`;
    expect(detectPageVersion({ html })).toBe("13");
  });

  it("reads doc-version meta tags", () => {
    const html = `<meta name="doc-version" content="5.2">`;
    expect(detectPageVersion({ html })).toBe("5.2");
  });

  it("reads a visible heading and ignores a hidden banner", () => {
    const html = `<h1 style="display:none">Next.js 99</h1><h1>Next.js 13</h1>`;
    expect(detectPageVersion({ html, url: "https://example.com/v15/docs" })).toBe("13");
  });

  it("prefers the version switcher over a heading and the URL", () => {
    const html = `<select id="version-switcher"><option value="15.4" selected>15.4</option></select>
      <h1>Next.js 13</h1>`;
    expect(detectPageVersion({ html, url: "https://example.com/v9/docs" })).toBe("15.4");
  });
});
