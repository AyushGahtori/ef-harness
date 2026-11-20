import { describe, expect, it } from "vitest";
import { BinderModeRouter } from "../../src/binder/index.js";
import { printEntry } from "./fixtures.js";

describe("BinderModeRouter", () => {
  const router = new BinderModeRouter();

  it("defaults to contract-bound for user-facing and directly declared entries", () => {
    expect(router.route({ entry: printEntry({ kind: "route", signature: "export function postKitchenPrint(request: RouteRequest): RouteResponse", exportName: "postKitchenPrint" }) })).toBe("contract_bound");
    expect(router.route({ entry: printEntry({ kind: "ui_button", signature: 'button "Print"' }) })).toBe("contract_bound");
    expect(router.route({ entry: printEntry({ kind: "openapi", signature: "POST /kitchen/print" }) })).toBe("contract_bound");
    expect(router.route({ entry: printEntry({ kind: "cli", signature: "kitchen print --json" }) })).toBe("contract_bound");
    expect(router.route({ entry: printEntry() })).toBe("contract_bound");
  });

  it("uses post-hoc binding only for internal setup or internal call wiring", () => {
    expect(router.route({ entry: printEntry({ kind: "route" }), adaptsInternalState: true })).toBe("post_hoc");
    expect(router.route({ entry: printEntry(), adaptsInternalCall: true })).toBe("post_hoc");
    expect(router.route({ entry: printEntry({ kind: "internal_setup", surface: "internal" }) })).toBe("post_hoc");
    expect(router.route({ entry: printEntry({ kind: "internal_call", surface: "internal" }) })).toBe("post_hoc");
    expect(
      router.route({
        entry: printEntry({ exportName: "otherName" }),
      }),
    ).toBe("post_hoc");
  });
});
