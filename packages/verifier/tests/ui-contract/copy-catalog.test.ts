import { describe, expect, it } from "vitest";
import {
  bindCopyCatalog,
  CopyCatalogLintError,
  CopyCatalogLinter,
  DuplicateControlNameError,
  UiInteractionContractSchema,
} from "../../src/ui-contract/index.js";

const linter = new CopyCatalogLinter();

describe("CopyCatalogLinter", () => {
  it("accepts the planner line kitchen.loadError", () => {
    const catalog = linter.lint('kitchen.loadError: "Couldn\'t load orders"\n');
    expect(catalog.entries[0]).toMatchObject({
      key: "kitchen.loadError",
      text: "Couldn't load orders",
      screen: "kitchen",
      matchMode: "normalized",
    });
  });

  it("rejects duplicate accessible names that are not region scoped", () => {
    expect(() =>
      linter.lint({
        "kitchen.headerPrint": { text: "Print", role: "button" },
        "kitchen.rowPrint": { text: "Print", role: "button" },
      }),
    ).toThrow(DuplicateControlNameError);
  });

  it("allows the same name when each control is scoped to a landmark", () => {
    const catalog = linter.lint({
      "kitchen.headerPrint": { text: "Print", role: "button", within: { role: "banner" } },
      "kitchen.rowPrint": { text: "Print", role: "button", within: { role: "row" } },
    });
    expect(catalog.entries).toHaveLength(2);
  });

  it("rejects empty and generic labels", () => {
    expect(() => linter.lint('kitchen.empty: ""')).toThrow(CopyCatalogLintError);
    for (const label of ["Click here", "Submit", "Button", "OK"]) {
      expect(() => linter.lint(`kitchen.cta: {text: "${label}", role: button}`)).toThrow(/Generic label/);
    }
  });

  it("rejects buttons that are not named by their action", () => {
    expect(() => linter.lint('kitchen.totals: {text: "Kitchen totals", role: button}')).toThrow(
      /not named by its action/,
    );
    const named = linter.lint('kitchen.print: {text: "Print", role: button}');
    expect(named.entries[0]?.text).toBe("Print");
  });

  it("rejects names that do not match the declared role", () => {
    expect(() => linter.lint('kitchen.field: {text: "Print", role: textbox}')).toThrow(/incompatible with role textbox/);
    expect(() => linter.lint('kitchen.title: {text: "Print", role: heading}')).toThrow(/incompatible with role heading/);
    const heading = linter.lint('kitchen.title: {text: "Kitchen totals", role: heading}');
    expect(heading.entries[0]?.role).toBe("heading");
  });

  it("binds contract strings through catalog keys and rejects invented copy", () => {
    const catalog = linter.lint({
      "kitchen.print": { text: "Print", role: "button" },
      "kitchen.title": { text: "Kitchen totals", role: "heading" },
    });
    const contract = UiInteractionContractSchema.parse({
      contract: "kitchen-list/ui@1",
      route: "/kitchen",
      as: { role: "kitchen_staff" },
      landmarks: [{ heading: { copyKey: "kitchen.title" } }],
      actions: [{ button: { copyKey: "kitchen.print" } }],
    });
    const bound = bindCopyCatalog(contract, catalog);
    expect(bound.actions[0]?.name?.text).toBe("Print");
    expect(bound.landmarks[0]?.name?.text).toBe("Kitchen totals");
    expect(() =>
      bindCopyCatalog(
        UiInteractionContractSchema.parse({
          contract: "kitchen-list/ui@1",
          route: "/kitchen",
          as: { role: "kitchen_staff" },
          actions: [{ button: "Invented label" }],
        }),
        catalog,
      ),
    ).toThrow(/not in the copy catalog/);
  });
});
