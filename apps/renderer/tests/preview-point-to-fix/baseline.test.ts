import { describe, expect, it } from "vitest";
import {
  BeforeAfterBaselineApprover,
  InMemoryVisualBaselineStore,
  verifyCrossViewportAfterFix,
} from "../../src/preview/point-to-fix/index.js";

describe("BeforeAfterBaselineApprover", () => {
  it("approves and writes Task 174 visual regression baseline", () => {
    const store = new InMemoryVisualBaselineStore();
    const approver = new BeforeAfterBaselineApprover(store);
    const cross = verifyCrossViewportAfterFix({
      pickedViewport: 375,
      desktopOk: true,
      mobileOk: true,
    });
    approver.present({
      baselineKey: "orders-submit-375",
      beforeCropRef: "cas:before",
      afterCropRef: "cas:after",
      viewportWidth: 375,
      crossViewport: cross,
    });
    const approved = approver.approveAndUpdateBaseline();
    expect(approved?.status).toBe("approved");
    expect(store.getBaseline("orders-submit-375")).toBe("cas:after");
  });

  it("reverts cleanly on Revert Fix", () => {
    const store = new InMemoryVisualBaselineStore();
    store.putApprovedBaseline("k", "cas:old");
    const approver = new BeforeAfterBaselineApprover(store);
    approver.present({
      baselineKey: "k",
      beforeCropRef: "cas:before",
      afterCropRef: "cas:after",
      viewportWidth: 1440,
      crossViewport: verifyCrossViewportAfterFix({
        pickedViewport: 1440,
        desktopOk: true,
        mobileOk: true,
      }),
    });
    const reverted = approver.revertFix();
    expect(reverted?.status).toBe("reverted");
    expect(store.getBaseline("k")).toBeNull();
  });

  it("blocks approval when cross-viewport desktop check fails", () => {
    const approver = new BeforeAfterBaselineApprover(new InMemoryVisualBaselineStore());
    const blocked = approver.present({
      baselineKey: "k",
      beforeCropRef: "b",
      afterCropRef: "a",
      viewportWidth: 375,
      crossViewport: verifyCrossViewportAfterFix({
        pickedViewport: 375,
        desktopOk: false,
        mobileOk: true,
      }),
    });
    expect("blocked" in blocked && blocked.blocked).toBe(true);
  });
});