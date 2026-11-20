import { describe, expect, it } from "vitest";
import { ContractSchemaError, UiInteractionContractSchema } from "../../src/ui-contract/index.js";

const SPEC_YAML = `
contract: kitchen-list/ui@1
route: /kitchen
as: {role: kitchen_staff}            # seeded test identity
landmarks:
  - heading: "Kitchen totals"
  - table:   {name: "Totals by dish", columns: ["Dish", "Quantity"]}
actions:
  - button: "Print"                  # accessible name; location is free
states:
  empty:   {text: "No orders yet"}
  loading: {role: progressbar}
testids:                             # only where no user-facing name exists
  - kitchen-row                      # each table row, data-testid="kitchen-row"
`;

describe("UiInteractionContractSchema", () => {
  it("parses the published kitchen interaction contract", () => {
    const contract = UiInteractionContractSchema.parse(SPEC_YAML);
    expect(contract.contract).toBe("kitchen-list/ui@1");
    expect(contract.route).toBe("/kitchen");
    expect(contract.as.role).toBe("kitchen_staff");
    expect(contract.landmarks[0]).toEqual({
      role: "heading",
      name: { text: "Kitchen totals", matchMode: "normalized" },
    });
    expect(contract.landmarks[1]).toEqual({
      role: "table",
      name: { text: "Totals by dish", matchMode: "normalized" },
      columns: [
        { text: "Dish", matchMode: "normalized" },
        { text: "Quantity", matchMode: "normalized" },
      ],
    });
    expect(contract.actions).toEqual([
      { role: "button", name: { text: "Print", matchMode: "normalized" } },
    ]);
    expect(contract.states.map((state) => state.name)).toEqual(["empty", "loading"]);
    expect(contract.states[0]?.text).toEqual({ text: "No orders yet", matchMode: "normalized" });
    expect(contract.states[1]?.role).toBe("progressbar");
    expect(contract.testids).toEqual(["kitchen-row"]);
  });

  it("keeps per-string exact and contains match modes", () => {
    const contract = UiInteractionContractSchema.parse({
      contract: "kitchen-list/ui@1",
      route: "/kitchen",
      as: { role: "kitchen_staff" },
      landmarks: [
        { navigation: "Primary" },
        { main: true },
        { form: { name: "Kitchen filters", matchMode: "exact" } },
      ],
      actions: [
        { link: { name: "Orders", matchMode: "contains" } },
        { textbox: { name: "Search", matchMode: "exact" } },
        { combobox: { name: "Status" } },
        { button: { name: "Print", within: { role: "banner" } } },
      ],
      states: {
        error: { text: "Couldn't load orders", matchMode: "normalized" },
        unauthorized: { text: "You cannot view the kitchen" },
        populated: {},
      },
    });
    expect(contract.landmarks.map((landmark) => landmark.role)).toEqual(["navigation", "main", "form"]);
    expect(contract.landmarks[2]?.name?.matchMode).toBe("exact");
    expect(contract.actions[0]?.name?.matchMode).toBe("contains");
    expect(contract.actions[1]?.name?.matchMode).toBe("exact");
    expect(contract.actions[3]?.within).toEqual({ role: "banner" });
    expect(contract.states.map((state) => state.name)).toEqual(["error", "unauthorized", "populated"]);
  });

  it("rejects a test id on a control that already has a unique accessible name", () => {
    expect(() =>
      UiInteractionContractSchema.parse({
        contract: "kitchen-list/ui@1",
        route: "/kitchen",
        as: { role: "kitchen_staff" },
        actions: [{ button: { name: "Print", testid: "print-button" } }],
        testids: ["print-button"],
      }),
    ).toThrow(ContractSchemaError);
  });
});
