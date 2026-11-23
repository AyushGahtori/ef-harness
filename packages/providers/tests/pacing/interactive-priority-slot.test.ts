import { describe, expect, it } from "vitest";
import { InteractivePrioritySlot, isInteractiveRequest } from "../../src/pacing/index.js";

describe("pacing interactive priority slot", () => {
  it("lets a steering question run while every normal cwnd slot is busy", () => {
    const slots = new InteractivePrioritySlot();
    expect(slots.tryAcquire("background", 4)).toBe(true);
    expect(slots.tryAcquire("background", 4)).toBe(true);
    expect(slots.tryAcquire("background", 4)).toBe(true);
    expect(slots.tryAcquire("background", 4)).toBe(true);
    expect(slots.tryAcquire("background", 4)).toBe(false);
    expect(isInteractiveRequest("ask-owner-responder@1", "background")).toBe(true);
    expect(slots.tryAcquire("interactive", 4)).toBe(true);
    expect(slots.tryAcquire("interactive", 4)).toBe(false);
    slots.release("interactive");
    expect(slots.tryAcquire("interactive", 0)).toBe(true);
  });
});
