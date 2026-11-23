import { describe, expect, it } from "vitest";
import { MemoryProjectStateCatalog, ProjectVerifiedSpokenIdNormalizer } from "../../src/vocabulary/index.js";

function kitchenCatalog(): MemoryProjectStateCatalog {
  const catalog = new MemoryProjectStateCatalog();
  catalog.add("kitchen", "rule", "R2");
  catalog.add("kitchen", "rule", "R17");
  catalog.add("kitchen", "task", "T-42");
  for (let id = 1; id <= 15; id += 1) {
    catalog.add("kitchen", "task", `T-${id}`);
  }
  catalog.add("kitchen", "worker", "A0014");
  catalog.add("kitchen", "requirement", "REQ-3");
  return catalog;
}

describe("ProjectVerifiedSpokenIdNormalizer", () => {
  const normalizer = new ProjectVerifiedSpokenIdNormalizer(kitchenCatalog());

  it("normalizes spoken ids that exist in state.db", () => {
    expect(normalizer.normalize("kitchen", "rule seventeen").text).toBe("R17");
    expect(normalizer.normalize("kitchen", "are seventeen").text).toBe("R17");
    expect(normalizer.normalize("kitchen", "change rule two").text).toBe("change R2");
    expect(normalizer.normalize("kitchen", "open R two").text).toBe("open R2");
    expect(normalizer.normalize("kitchen", "task forty two").text).toBe("T-42");
    expect(normalizer.normalize("kitchen", "T forty two").text).toBe("T-42");
    expect(normalizer.normalize("kitchen", "agent zero zero fourteen").text).toBe("A0014");
    expect(normalizer.normalize("kitchen", "A fourteen").text).toBe("A0014");
    expect(normalizer.normalize("kitchen", "requirement three").text).toBe("REQ-3");
    expect(normalizer.normalize("kitchen", "req three").text).toBe("REQ-3");
    expect(normalizer.normalize("kitchen", "open rule seventeen and task forty two").text).toBe(
      "open R17 and T-42",
    );
  });

  it("leaves natural English and nonexistent ids untouched", () => {
    expect(normalizer.normalize("kitchen", "there are two menus").text).toBe("there are two menus");
    expect(normalizer.normalize("kitchen", "there are two tables").text).toBe("there are two tables");
    expect(normalizer.normalize("kitchen", "they are two menus").text).toBe("they are two menus");
    expect(normalizer.normalize("kitchen", "we are two menus").text).toBe("we are two menus");
    expect(normalizer.normalize("kitchen", "you are two menus").text).toBe("you are two menus");
    expect(normalizer.normalize("kitchen", "There are two menus").text).toBe("There are two menus");
    expect(normalizer.normalize("kitchen", "check task ninety nine").text).toBe("check task ninety nine");
    expect(normalizer.normalize("kitchen", "rule ninety nine").text).toBe("rule ninety nine");
    const empty = new ProjectVerifiedSpokenIdNormalizer(new MemoryProjectStateCatalog());
    expect(empty.normalize("kitchen", "there are two tables").text).toBe("there are two tables");
    expect(empty.normalize("kitchen", "are two tables").text).toBe("are two tables");
    expect(empty.normalize("kitchen", "A fourteen").text).toBe("A fourteen");
    expect(normalizer.normalize("expense", "A fourteen").text).toBe("A fourteen");
    expect(normalizer.normalize("expense", "change rule two").text).toBe("change rule two");
  });
});
