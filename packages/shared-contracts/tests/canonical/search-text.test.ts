import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { splitSearchText } from "../../src/canonical/index.js";

function ftsMatches(body: string, match: string): boolean {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE VIRTUAL TABLE docs USING fts5(body, tokenize = 'unicode61 remove_diacritics 2')",
  );
  db.prepare("INSERT INTO docs(body) VALUES (?)").run(body);
  const row = db.prepare("SELECT rowid FROM docs WHERE docs MATCH ?").get(match);
  db.close();
  return row !== undefined;
}

describe("splitSearchText", () => {
  it("matches schema-test.js on the indexed kitchen strings", () => {
    expect(splitSearchText("toPrintRows")).toBe("toPrintRows to Print Rows");
    expect(splitSearchText("Map totals with toPrintRows")).toBe(
      "Map totals with toPrintRows Map totals with to Print Rows",
    );
    expect(splitSearchText("Orders close at 10:45 Europe/Berlin")).toBe(
      "Orders close at 10:45 Europe/Berlin Orders close at 10 45 Europe Berlin",
    );
    expect(ftsMatches(splitSearchText("Map totals with toPrintRows"), "print AND rows")).toBe(true);
    expect(ftsMatches(splitSearchText("Orders close at 10:45 Europe/Berlin"), "close AND 10")).toBe(
      true,
    );
    expect(ftsMatches(splitSearchText("Orders close at 10:30"), "close AND 10")).toBe(true);
  });

  it("splits camelCase, PascalCase, acronyms, separators, and paths", () => {
    expect(splitSearchText("XMLHttpRequest")).toBe("XMLHttpRequest XML Http Request");
    expect(splitSearchText("HTTPServer")).toBe("HTTPServer HTTP Server");
    expect(splitSearchText("getURLForID")).toBe("getURLForID get URL For ID");
    expect(splitSearchText("PrintRows")).toBe("PrintRows Print Rows");
    expect(splitSearchText("snake_case")).toBe("snake_case snake case");
    expect(splitSearchText("kebab-case")).toBe("kebab-case kebab case");
    expect(splitSearchText("src/app/kitchen")).toBe("src/app/kitchen src app kitchen");
    expect(splitSearchText("file.name")).toBe("file.name file name");
    expect(splitSearchText("a.b:c")).toBe("a.b:c a b c");
    expect(splitSearchText("XMLHttpRequest")).toContain("XMLHttpRequest");
    expect(splitSearchText("XMLHttpRequest")).toContain("XML Http Request");
  });

  it("returns an empty string for empty and nullish input", () => {
    expect(splitSearchText("")).toBe("");
    expect(splitSearchText(null)).toBe("");
    expect(splitSearchText(undefined)).toBe("");
    expect(splitSearchText(0)).toBe("");
    expect(splitSearchText(false)).toBe("");
  });
});
