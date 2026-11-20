import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AmbiguousEditMatchError,
  applyMatchedReplacement,
  FourTierMatcher,
} from "../../src/edits/index.js";

const matcher = new FourTierMatcher();
const word = fc.stringMatching(/^[A-Za-z0-9]{1,12}$/);

describe("FourTierMatcher properties", () => {
  it("preserves CRLF and leaves every untouched line intact", () => {
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 4, maxLength: 8 }),
        word,
        word,
        (lines, left, right) => {
          fc.pre(new Set(lines).size === lines.length);
          const file = `${lines.join("\r\n")}\r\n`;
          const search = `${lines[1]}\n${lines[2]}`;
          const match = matcher.match(file, search);
          expect(match.tier).toBe(2);
          const next = applyMatchedReplacement(file, match, `${left}\n${right}`);
          expect(next).not.toMatch(/(?<!\r)\n/);
          const result = next.split("\r\n").slice(0, -1);
          expect(result[0]).toBe(lines[0]);
          expect(result[1]).toBe(left);
          expect(result[2]).toBe(right);
          expect(result.slice(3)).toEqual(lines.slice(3));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("shifts replacement indentation by the block delta and keeps relative nesting", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 1, max: 4 }),
        word,
        word,
        word,
        (fileIndent, extra, name, nested, rewritten) => {
          fc.pre(extra < fileIndent);
          const searchIndent = fileIndent - extra;
          const fileBlock = [
            `${" ".repeat(fileIndent)}block ${name} {`,
            `${" ".repeat(fileIndent + 2)}nested ${nested};`,
          ];
          const searchBlock = [
            `${" ".repeat(searchIndent)}block ${name} {`,
            `${" ".repeat(searchIndent + 2)}nested ${nested};`,
          ];
          const replacement = [
            `${" ".repeat(searchIndent)}block ${rewritten} {`,
            `${" ".repeat(searchIndent + 2)}nested ${nested};`,
          ];
          const file = ["SENTINEL_BEFORE", ...fileBlock, "SENTINEL_AFTER"].join("\n");
          const match = matcher.match(file, searchBlock.join("\n"));
          expect(match.tier).toBe(4);
          const next = applyMatchedReplacement(file, match, replacement.join("\n"));
          expect(next).toBe(
            [
              "SENTINEL_BEFORE",
              `${" ".repeat(fileIndent)}block ${rewritten} {`,
              `${" ".repeat(fileIndent + 2)}nested ${nested};`,
              "SENTINEL_AFTER",
            ].join("\n"),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("round-trips a unique exact replacement and refuses to guess duplicates", () => {
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 4, maxLength: 8 }),
        word,
        (lines, token) => {
          fc.pre(new Set(lines).size === lines.length);
          const search = lines[1] ?? "";
          fc.pre(search.length > 0);
          fc.pre(lines.every((line, index) => index === 1 || !line.includes(search)));
          fc.pre(lines.every((line) => !line.includes(token)));
          const file = `${lines.join("\n")}\n`;
          const match = matcher.match(file, search);
          expect(match.tier).toBe(1);
          const next = applyMatchedReplacement(file, match, token);
          expect(next.slice(0, match.startOffset)).toBe(file.slice(0, match.startOffset));
          expect(next.slice(match.startOffset + token.length)).toBe(file.slice(match.endOffset));
          const restored = applyMatchedReplacement(next, matcher.match(next, token), search);
          expect(restored).toBe(file);

          const duplicated = [lines[0], search, lines[2], search].join("\n");
          expect(() => matcher.match(duplicated, search)).toThrow(AmbiguousEditMatchError);
          try {
            matcher.match(duplicated, search);
          } catch (error) {
            expect(error).toBeInstanceOf(AmbiguousEditMatchError);
            expect((error as AmbiguousEditMatchError).matchLineNumbers).toEqual([2, 4]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
