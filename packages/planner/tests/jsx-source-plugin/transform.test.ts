import { describe, expect, it } from "vitest";
import {
  countEfSourceOccurrences,
  createDevOnlyJsxSourceTagPlugin,
  listInjectedSourceTags,
  transformJsxWithSourceTags,
} from "../../src/jsx-source-plugin/index.js";

const ORDER_FORM_FIXTURE = `import React from "react";

export function OrderForm() {
  return (
    <form>
      <Button type="submit">Submit Order</Button>
    </form>
  );
}
`;

describe("DevOnlyJsxSourceTagPlugin transform", () => {
  it("tags JSX host elements in development with accurate line/column", () => {
    const dev = transformJsxWithSourceTags(ORDER_FORM_FIXTURE, "src/pages/OrderForm.tsx", {
      production: false,
    });
    expect(dev).toContain('data-ef-source="src/pages/OrderForm.tsx:5:');
    expect(dev).toContain('data-ef-source="src/pages/OrderForm.tsx:6:');
    const tags = listInjectedSourceTags(dev, "src/pages/OrderForm.tsx");
    expect(tags.length).toBeGreaterThanOrEqual(2);
    expect(tags.some((t) => t.tag === "Button")).toBe(true);
  });

  it("emits zero data-ef-source bytes in production builds", () => {
    const prod = transformJsxWithSourceTags(ORDER_FORM_FIXTURE, "src/pages/OrderForm.tsx", {
      production: true,
    });
    expect(prod).toBe(ORDER_FORM_FIXTURE);
    expect(countEfSourceOccurrences(prod)).toBe(0);
  });

  it("vite plugin transform is inert when mode is production", () => {
    const plugin = createDevOnlyJsxSourceTagPlugin({ mode: "production" });
    const result = plugin.transform?.(ORDER_FORM_FIXTURE, "src/pages/OrderForm.tsx");
    expect(result).toBeNull();
  });

  it("vite plugin injects tags in development serve mode", () => {
    const plugin = createDevOnlyJsxSourceTagPlugin({
      mode: "development",
      rootDir: "C:/proj",
    });
    const out = plugin.transform?.(ORDER_FORM_FIXTURE, "C:/proj/src/pages/OrderForm.tsx");
    expect(out?.code).toContain("data-ef-source=");
    expect(countEfSourceOccurrences(out?.code ?? "")).toBeGreaterThan(0);
  });

  it("simulated prod bundle grep finds zero occurrences", () => {
    const devBundle = transformJsxWithSourceTags(ORDER_FORM_FIXTURE, "src/pages/OrderForm.tsx", {
      production: false,
    });
  const prodBundle = transformJsxWithSourceTags(devBundle, "src/pages/OrderForm.tsx", {
      production: true,
    });
    expect(countEfSourceOccurrences(prodBundle)).toBe(0);
    expect(countEfSourceOccurrences(devBundle)).toBeGreaterThan(0);
  });
});