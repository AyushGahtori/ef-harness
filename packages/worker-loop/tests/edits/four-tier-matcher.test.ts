import { describe, expect, it } from "vitest";
import {
  AmbiguousEditMatchError,
  applyMatchedReplacement,
  FourTierMatcher,
  SearchTextNotFoundError,
} from "../../src/edits/index.js";

const matcher = new FourTierMatcher();

describe("FourTierMatcher", () => {
  it("matches exact text at tier 1 and rejects a second copy", () => {
    const lines = Array.from({ length: 60 }, (_, index) => `const line${index + 1} = ${index + 1};`);
    lines[13] = "return null;";
    lines[47] = "return null;";
    try {
      matcher.match(lines.join("\n"), "return null;");
      throw new Error("expected ambiguity");
    } catch (caught) {
      expect(caught).toBeInstanceOf(AmbiguousEditMatchError);
      expect((caught as AmbiguousEditMatchError).matchLineNumbers).toEqual([14, 48]);
    }
    const file = ["const ready = true;", "return null;", "const other = 1;"].join("\n");
    const unique = matcher.match(file, "const ready = true;");
    expect(unique.tier).toBe(1);
    expect(applyMatchedReplacement(file, unique, "const ready = false;")).toBe(
      ["const ready = false;", "return null;", "const other = 1;"].join("\n"),
    );
  });

  it("matches LF search in a CRLF file at tier 2 and writes CRLF back", () => {
    const file = "alpha\r\nbeta\r\ngamma\r\n";
    const match = matcher.match(file, "alpha\nbeta");
    expect(match.tier).toBe(2);
    expect(match.startLine).toBe(1);
    const next = applyMatchedReplacement(file, match, "ALPHA\nBETA");
    expect(next).toBe("ALPHA\r\nBETA\r\ngamma\r\n");
    expect(next).not.toMatch(/(?<!\r)\n/);
  });

  it("rejects two CRLF sites at tier 2 instead of guessing the first", () => {
    const file = "keep\r\nblock\r\ntail\r\nkeep\r\nblock\r\ntail\r\n";
    try {
      matcher.match(file, "keep\nblock\ntail");
      throw new Error("expected ambiguity");
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousEditMatchError);
      expect((error as AmbiguousEditMatchError).matchLineNumbers).toEqual([1, 4]);
    }
    expect(file.startsWith("keep\r\n")).toBe(true);
  });

  it("ignores trailing horizontal whitespace at tier 3 and stops when two lines match", () => {
    const unique = "alpha  \nbeta\ngamma\n";
    const match = matcher.match(unique, "alpha\nbeta");
    expect(match.tier).toBe(3);
    expect(applyMatchedReplacement(unique, match, "ALPHA\nBETA")).toBe("ALPHA\nBETA\ngamma\n");

    const ambiguous = "alpha \nbeta\nalpha\t\nbeta\n";
    try {
      matcher.match(ambiguous, "alpha\nbeta");
      throw new Error("expected ambiguity");
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousEditMatchError);
      expect((error as AmbiguousEditMatchError).matchLineNumbers).toEqual([1, 3]);
    }
  });

  it("reindents a 2-space replacement onto a 4-space block at tier 4", () => {
    const file = ["before", "    function foo() {", "      return 1;", "    }", "after"].join("\n");
    const search = ["  function foo() {", "    return 1;", "  }"].join("\n");
    const replacement = ["  function foo() {", "    return 2;", "  }"].join("\n");
    const match = matcher.match(file, search);
    expect(match.tier).toBe(4);
    expect(match.startLine).toBe(2);
    expect(match.fileBaseIndent).toBe("    ");
    expect(applyMatchedReplacement(file, match, replacement)).toBe(
      ["before", "    function foo() {", "      return 2;", "    }", "after"].join("\n"),
    );
  });

  it("rejects two indent-only matches at tier 4", () => {
    const block = (indent: number): string[] => [
      `${" ".repeat(indent)}if (ok) {`,
      `${" ".repeat(indent + 2)}return 1;`,
      `${" ".repeat(indent)}}`,
    ];
    const file = [...block(4), ...block(8)].join("\n");
    const search = block(2).join("\n");
    try {
      matcher.match(file, search);
      throw new Error("expected ambiguity");
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousEditMatchError);
      expect((error as AmbiguousEditMatchError).matchLineNumbers).toEqual([1, 4]);
    }
  });

  it("does not treat a different relative indent as the same block", () => {
    const file = ["    if (ready) {", "      return 1;", "    }"].join("\n");
    const search = ["  if (ready) {", "  return 1;", "  }"].join("\n");
    expect(() => matcher.match(file, search)).toThrow(SearchTextNotFoundError);
  });
});
