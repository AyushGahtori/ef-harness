import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AmbiguousEditMatchError,
  EditStuckEscalation,
  EditToolNotOfferedError,
  ElisionPlaceholderError,
  FileAlreadyExistsError,
  FileChangedExternallyError,
  FreshRegionViewError,
  NearestCandidateError,
  PathEscapeDeniedError,
  ProtectedPathError,
  ReplaceLinesNotEnabledError,
  ReplaceLinesUnlockedError,
  SMALLER_HUNK_HINT,
  StaleRangeHashError,
  WriteScopeDeniedError,
  hashLineRange,
  parseOpenAiApplyPatch,
} from "../../src/edits/index.js";
import { capture, harness, readFile, searchReplaceDocument, tempWorktree, writeFile } from "./helpers.js";

function recoveryFile(): string {
  const lines: string[] = [];
  for (let line = 1; line <= 60; line += 1) {
    if (line === 40) lines.push("export function closestRegion() {");
    else if (line === 41) lines.push('  const alpha = "nearest-candidate";');
    else if (line === 42) lines.push('  const beta = "windowed-view";');
    else if (line === 43) lines.push('  const gamma = "range-hash";');
    else if (line === 44) lines.push('  const delta = "stuck-escalation";');
    else if (line === 45) lines.push('  const epsilon = "edit-recovery";');
    else if (line === 46) lines.push('  const zeta = "four-tier";');
    else if (line === 47) lines.push('  const eta = "line-endings";');
    else if (line === 48) lines.push('  const theta = "indentation";');
    else if (line === 49) lines.push('  const iota = "write-scope";');
    else if (line === 50) lines.push('  const kappa = "elision-block";');
    else if (line === 51) lines.push("  return alpha;");
    else if (line === 52) lines.push("}");
    else lines.push(`const filler${String(line).padStart(2, "0")} = "qqqqqqqq";`);
  }
  return `${lines.join("\n")}\n`;
}

function missedSearch(content: string): string {
  return content.split("\n").slice(39, 52).join("\n").replace("closestRegion", "closestRegon");
}

describe("EditToolDispatcher", () => {
  it("offers only the trained edit format plus write_new_file", () => {
    const root = tempWorktree();
    const patch = harness({ root, editFormat: "apply_patch" });
    const claude = harness({ root, editFormat: "str_replace" });
    const local = harness({ root, editFormat: "search_replace" });
    expect(patch.edit.availableTools()).toEqual(["apply_patch", "write_new_file"]);
    expect(claude.edit.availableTools()).toEqual(["str_replace", "write_new_file"]);
    expect(local.edit.availableTools()).toEqual(["search_replace", "write_new_file"]);
    expect(patch.edit.availableTools().join(" ")).not.toContain("write_file");
    writeFile(root, "src/a.ts", "one\n");
    expect(() => patch.edit.strReplace("src/a.ts", "one", "two")).toThrow(EditToolNotOfferedError);
    expect(() => claude.edit.applyPatch("*** Begin Patch\n*** End Patch\n")).toThrow(EditToolNotOfferedError);
    expect(readFile(root, "src/a.ts")).toBe("one\n");
  });

  it("applies apply_patch, str_replace, and search_replace without formatting", () => {
    const root = tempWorktree();
    const source = 'export const label = "alpha";\nexport const other = "beta";\n';
    writeFile(root, "src/a.ts", source);
    const claude = harness({ root, editFormat: "str_replace", writeScope: ["src/**"] });
    claude.edit.strReplace("src/a.ts", 'export const label = "alpha";', 'export const label = "ALPHA";');
    expect(readFile(root, "src/a.ts")).toBe('export const label = "ALPHA";\nexport const other = "beta";\n');

    const local = harness({ root, editFormat: "search_replace", writeScope: ["src/**"] });
    local.edit.searchReplace(
      searchReplaceDocument([
        {
          path: "src/a.ts",
          search: 'export const other = "beta";',
          replace: 'export const other = "BETA";',
        },
      ]),
    );
    expect(readFile(root, "src/a.ts")).toBe('export const label = "ALPHA";\nexport const other = "BETA";\n');

    const openai = harness({ root, editFormat: "apply_patch", writeScope: ["src/**"] });
    openai.edit.applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        '-export const label = "ALPHA";',
        '+export const label = "patched";',
        "*** End Patch",
      ].join("\n"),
    );
    expect(readFile(root, "src/a.ts")).toBe('export const label = "patched";\nexport const other = "BETA";\n');
  });

  it("preserves CRLF through apply_patch and shifts indentation through str_replace", () => {
    const root = tempWorktree();
    writeFile(root, "src/win.ts", "alpha\r\nbeta\r\ngamma\r\n");
    const openai = harness({ root, editFormat: "apply_patch" });
    openai.edit.applyPatch(
      ["*** Begin Patch", "*** Update File: src/win.ts", "@@", "-alpha", "-beta", "+ALPHA", "+BETA", "*** End Patch"].join(
        "\n",
      ),
    );
    const crlf = readFile(root, "src/win.ts");
    expect(crlf).toBe("ALPHA\r\nBETA\r\ngamma\r\n");
    expect(crlf).not.toMatch(/(?<!\r)\n/);

    const indented = ["before", "    function foo() {", "      return 1;", "    }", "after", ""].join("\n");
    writeFile(root, "src/indent.ts", indented);
    const claude = harness({ root, editFormat: "str_replace" });
    claude.edit.strReplace(
      "src/indent.ts",
      ["  function foo() {", "    return 1;", "  }"].join("\n"),
      ["  function foo() {", "    return 2;", "  }"].join("\n"),
    );
    expect(readFile(root, "src/indent.ts")).toBe(
      ["before", "    function foo() {", "      return 2;", "    }", "after", ""].join("\n"),
    );
  });

  it("rejects write_new_file and apply_patch add when the file already exists", () => {
    const root = tempWorktree();
    writeFile(root, "src/a.ts", "kept\n");
    const claude = harness({ root, editFormat: "str_replace" });
    const error = capture<FileAlreadyExistsError>(() => claude.edit.writeNewFile("src/a.ts", "overwrite\n"));
    expect(error).toBeInstanceOf(FileAlreadyExistsError);
    expect(error.message).toBe("Use str_replace for existing files");
    expect(readFile(root, "src/a.ts")).toBe("kept\n");

    const openai = harness({ root, editFormat: "apply_patch" });
    expect(() =>
      openai.edit.applyPatch(["*** Begin Patch", "*** Add File: src/a.ts", "+overwrite", "*** End Patch"].join("\n")),
    ).toThrow(FileAlreadyExistsError);
    expect(readFile(root, "src/a.ts")).toBe("kept\n");

    claude.edit.writeNewFile("src/nested/new.ts", "export const created = true;\n");
    expect(readFile(root, "src/nested/new.ts")).toBe("export const created = true;\n");
  });

  it("aborts a multi-file patch before writing when any path is outside write_scope", () => {
    const root = tempWorktree();
    writeFile(root, "src/a.ts", "one\n");
    writeFile(root, "tests/protected.test.ts", "keep\n");
    const { edit } = harness({ root, editFormat: "apply_patch", writeScope: ["src/**"] });
    const error = capture<WriteScopeDeniedError>(() =>
      edit.applyPatch(
        [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "-one",
          "+ONE",
          "*** Update File: tests/protected.test.ts",
          "@@",
          "-keep",
          "+KEEP",
          "*** End Patch",
        ].join("\n"),
      ),
    );
    expect(error).toBeInstanceOf(WriteScopeDeniedError);
    expect(readFile(root, "src/a.ts")).toBe("one\n");
    expect(readFile(root, "tests/protected.test.ts")).toBe("keep\n");
  });

  it("leaves the file unchanged when a later hunk does not match", () => {
    const root = tempWorktree();
    writeFile(root, "src/a.ts", "alpha\nbeta\ngamma\n");
    const { edit } = harness({ root, editFormat: "apply_patch" });
    expect(() =>
      edit.applyPatch(
        [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "-alpha",
          "+ALPHA",
          "@@",
          "-missing",
          "+MISSING",
          "*** End Patch",
        ].join("\n"),
      ),
    ).toThrow(NearestCandidateError);
    expect(readFile(root, "src/a.ts")).toBe("alpha\nbeta\ngamma\n");
  });

  it("applies every hunk or none, and can delete, add, and move inside scope", () => {
    const root = tempWorktree();
    writeFile(root, "src/a.ts", "alpha\nbeta\ngamma\n");
    writeFile(root, "src/old.ts", "move-me\n");
    const { edit } = harness({ root, editFormat: "apply_patch", writeScope: ["src/**"] });
    edit.applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-alpha",
        "+ALPHA",
        "@@",
        "-gamma",
        "+GAMMA",
        "*** Add File: src/created.ts",
        "+export const added = 1;",
        "*** Delete File: src/old.ts",
        "*** End Patch",
      ].join("\n"),
    );
    expect(readFile(root, "src/a.ts")).toBe("ALPHA\nbeta\nGAMMA\n");
    expect(readFile(root, "src/created.ts")).toBe("export const added = 1;\n");
    expect(fs.existsSync(path.join(root, "src/old.ts"))).toBe(false);

    writeFile(root, "src/from.ts", "body\n");
    edit.applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: src/from.ts",
        "*** Move to: src/to.ts",
        "@@",
        "-body",
        "+moved",
        "*** End Patch",
      ].join("\n"),
    );
    expect(fs.existsSync(path.join(root, "src/from.ts"))).toBe(false);
    expect(readFile(root, "src/to.ts")).toBe("moved\n");
  });

  it("uses @@ anchors to choose one of two identical blocks", () => {
    const root = tempWorktree();
    const source = ["class Alpha {", "  method() { return 1; }", "}", "class Beta {", "  method() { return 1; }", "}", ""].join(
      "\n",
    );
    writeFile(root, "src/dual.ts", source);
    const { edit } = harness({ root, editFormat: "apply_patch" });
    edit.applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: src/dual.ts",
        "@@ class Beta {",
        "-  method() { return 1; }",
        "+  method() { return 2; }",
        "*** End Patch",
      ].join("\n"),
    );
    expect(readFile(root, "src/dual.ts")).toBe(
      ["class Alpha {", "  method() { return 1; }", "}", "class Beta {", "  method() { return 2; }", "}", ""].join("\n"),
    );
    const parsed = parseOpenAiApplyPatch(
      ["*** Begin Patch", "*** Update File: src/dual.ts", "@@ class Beta {", "-  method() { return 1; }", "+  method() { return 2; }", "*** End Patch"].join(
        "\n",
      ),
    );
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]?.kind).toBe("update");
  });

  it("rejects protected paths, path escape, and elision before any byte is written", () => {
    const root = tempWorktree();
    writeFile(root, "src/a.ts", "value\n");
    writeFile(root, ".git/config", "[core]\n");
    writeFile(root, "node_modules/pkg/index.js", "module.exports = 1;\n");
    const { edit } = harness({ root, editFormat: "str_replace", writeScope: ["**"] });
    expect(() => edit.strReplace(".git/config", "[core]", "[no]")).toThrow(ProtectedPathError);
    expect(() => edit.strReplace("node_modules/pkg/index.js", "1", "2")).toThrow(ProtectedPathError);
    expect(() => edit.strReplace("../outside.ts", "a", "b")).toThrow(PathEscapeDeniedError);
    const placeholders = [
      "const value = 1;\n// ... existing code ...\n",
      "const value = 1;\n/* ... rest of file unchanged ... */\n",
      "const value = 1;\n# ... existing code ...\n",
      "const value = 1;\nrest of file unchanged\n",
    ];
    for (const replacement of placeholders) {
      expect(() => edit.strReplace("src/a.ts", "value", replacement)).toThrow(ElisionPlaceholderError);
    }
    expect(readFile(root, "src/a.ts")).toBe("value\n");
    expect(readFile(root, ".git/config")).toBe("[core]\n");
    expect(readFile(root, "node_modules/pkg/index.js")).toBe("module.exports = 1;\n");

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ef-edit-out-"));
    const link = path.join(root, "escape");
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "hidden\n");
      fs.symlinkSync(outside, link, "junction");
      expect(() => edit.strReplace("escape/secret.txt", "hidden", "nope")).toThrow(PathEscapeDeniedError);
      expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("hidden\n");
    } finally {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects an external modification and returns a numbered view of the changed region", () => {
    const root = tempWorktree();
    const original = "alpha\nbeta\ngamma\n";
    writeFile(root, "src/a.ts", original);
    const { edit, reader } = harness({ root, editFormat: "str_replace" });
    reader.note("attempt-1", "src/a.ts", original);
    fs.writeFileSync(path.join(root, "src/a.ts"), "alpha\nBETA\ngamma\n");
    const error = capture<FileChangedExternallyError>(() => edit.strReplace("src/a.ts", "alpha", "ALPHA"));
    expect(error).toBeInstanceOf(FileChangedExternallyError);
    expect(error.numberedView).toContain("BETA");
    expect(readFile(root, "src/a.ts")).toBe("alpha\nBETA\ngamma\n");
  });

  it("walks the 4-step recovery ladder and checks replace_lines hashes", () => {
    const root = tempWorktree();
    const original = recoveryFile();
    writeFile(root, "src/region.ts", original);
    writeFile(root, "src/other.ts", "other\n");
    const { edit } = harness({ root, editFormat: "str_replace", writeScope: ["src/**"] });
    const search = missedSearch(original);

    const first = capture<NearestCandidateError>(() => edit.strReplace("src/region.ts", search, "nope"));
    expect(first).toBeInstanceOf(NearestCandidateError);
    expect(first.failureIndex).toBe(1);
    expect(first.startLine).toBe(40);
    expect(first.endLine).toBe(52);
    expect(first.message).toContain("Your search text wasn't found. Closest match at lines 40\u201352:");
    expect(first.snippet).toContain("export function closestRegion()");

    const second = capture<FreshRegionViewError>(() => edit.strReplace("src/region.ts", search, "nope"));
    expect(second).toBeInstanceOf(FreshRegionViewError);
    expect(second.failureIndex).toBe(2);
    expect(second.hint).toBe(SMALLER_HUNK_HINT);
    expect(second.message).toContain("smaller hunk");
    expect(second.numberedView).toContain("L0040: export function closestRegion() {");

    const third = capture<ReplaceLinesUnlockedError>(() => edit.strReplace("src/region.ts", search, "nope"));
    expect(third).toBeInstanceOf(ReplaceLinesUnlockedError);
    expect(third.failureIndex).toBe(3);
    expect(third.rangeHash).toBe(hashLineRange(original, 40, 52, "src/region.ts"));
    expect(edit.availableTools("src/region.ts")).toContain("replace_lines");
    expect(edit.availableTools("src/other.ts")).not.toContain("replace_lines");
    expect(() => edit.replaceLines("src/other.ts", 1, 1, "nope\n", third.rangeHash)).toThrow(ReplaceLinesNotEnabledError);

    const stale = capture<StaleRangeHashError>(() =>
      edit.replaceLines("src/region.ts", 40, 52, "replaced\n", "f".repeat(64)),
    );
    expect(stale).toBeInstanceOf(StaleRangeHashError);
    expect(stale.currentRangeHash).toBe(third.rangeHash);
    expect(stale.currentLines).toContain("L0040: export function closestRegion() {");
    expect(readFile(root, "src/region.ts")).toBe(original);

    const fourth = capture<EditStuckEscalation>(() => edit.strReplace("src/region.ts", search, "nope"));
    expect(fourth).toBeInstanceOf(EditStuckEscalation);
    expect(fourth.failureIndex).toBe(4);
    expect(fourth.failureCount).toBe(4);
    expect(fourth.message).toContain("Checkpoint");
    expect(fourth.message).toContain("loop fingerprint ladder");
    expect(readFile(root, "src/region.ts")).toBe(original);
  });

  it("applies replace_lines only after the third failure and only with the current hash", () => {
    const root = tempWorktree();
    const original = "one\ntwo\nthree\n";
    writeFile(root, "src/a.ts", original);
    const { edit } = harness({ root, editFormat: "search_replace" });
    expect(() => edit.replaceLines("src/a.ts", 2, 2, "TWO\n", hashLineRange(original, 2, 2))).toThrow(
      ReplaceLinesNotEnabledError,
    );
    const miss = "not in the file";
    expect(() => edit.searchReplace([{ path: "src/a.ts", search: miss, replace: "x" }])).toThrow(NearestCandidateError);
    expect(() => edit.searchReplace([{ path: "src/a.ts", search: miss, replace: "x" }])).toThrow(FreshRegionViewError);
    const unlocked = capture<ReplaceLinesUnlockedError>(() =>
      edit.searchReplace([{ path: "src/a.ts", search: miss, replace: "x" }]),
    );
    expect(unlocked).toBeInstanceOf(ReplaceLinesUnlockedError);
    expect(edit.availableTools("src/a.ts")).toContain("replace_lines");
    edit.replaceLines("src/a.ts", 2, 2, "TWO", hashLineRange(original, 2, 2));
    expect(readFile(root, "src/a.ts")).toBe("one\nTWO\nthree\n");
    const rewritten = readFile(root, "src/a.ts");
    edit.replaceLines("src/a.ts", 1, 1, "ONE", hashLineRange(rewritten, 1, 1));
    expect(readFile(root, "src/a.ts")).toBe("ONE\nTWO\nthree\n");
    expect(() => edit.replaceLines("src/a.ts", 1, 1, "1", "wrong")).toThrow(StaleRangeHashError);

    const other = tempWorktree();
    writeFile(other, "src/a.ts", "keep\n");
    writeFile(other, "src/b.ts", "stay\n");
    const second = harness({ root: other, editFormat: "str_replace" });
    expect(() => second.edit.strReplace("src/a.ts", "missing", "x")).toThrow(NearestCandidateError);
    expect(() => second.edit.strReplace("src/a.ts", "missing", "x")).toThrow(FreshRegionViewError);
    second.edit.strReplace("src/a.ts", "keep", "kept");
    const afterSuccess = capture<NearestCandidateError>(() => second.edit.strReplace("src/a.ts", "missing", "x"));
    expect(afterSuccess).toBeInstanceOf(NearestCandidateError);
    expect(afterSuccess.failureIndex).toBe(1);
    expect(() => second.edit.replaceLines("src/b.ts", 1, 1, "no", hashLineRange("stay\n", 1, 1))).toThrow(
      ReplaceLinesNotEnabledError,
    );
  });

  it("rejects an ambiguous str_replace without modifying either line", () => {
    const root = tempWorktree();
    const lines = Array.from({ length: 60 }, (_, index) => `const line${index + 1} = ${index + 1};`);
    lines[13] = "return null;";
    lines[47] = "return null;";
    const original = `${lines.join("\n")}\n`;
    writeFile(root, "src/a.ts", original);
    const { edit } = harness({ root, editFormat: "str_replace" });
    const error = capture<AmbiguousEditMatchError>(() => edit.strReplace("src/a.ts", "return null;", "return 1;"));
    expect(error).toBeInstanceOf(AmbiguousEditMatchError);
    expect(error.matchLineNumbers).toEqual([14, 48]);
    expect(readFile(root, "src/a.ts")).toBe(original);
  });
});
