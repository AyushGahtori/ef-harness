import { describe, expect, it } from "vitest";
import {
  assertLineEndingsPreserved,
  assertNeverMutatesDeveloperCheckout,
  buildGitArgs,
  commandIsReadOnly,
  isLineEndingOverride,
} from "../../src/runner/classify.js";
import { DeveloperCheckoutMutationError, LineEndingProtectionError } from "../../src/runner/types.js";

const MUTATING = ["checkout", "reset", "stash", "clean", "add", "commit", "merge", "rebase", "init"] as const;

describe("command classification", () => {
  it("treats inspection commands as read-only", () => {
    for (const command of ["status", "rev-parse", "diff", "merge-tree", "log", "ls-tree", "ls-files"]) {
      expect(commandIsReadOnly([command])).toBe(true);
    }
    expect(commandIsReadOnly(["symbolic-ref", "-q", "HEAD"])).toBe(true);
    expect(commandIsReadOnly(["symbolic-ref", "--short", "HEAD"])).toBe(true);
    expect(commandIsReadOnly(["rev-parse", "--verify", "HEAD"])).toBe(true);
    expect(commandIsReadOnly(["rev-parse", "--git-path", "MERGE_HEAD"])).toBe(true);
    expect(commandIsReadOnly(["rev-parse", "--is-shallow-repository"])).toBe(true);
    expect(commandIsReadOnly(["status", "--porcelain=v1", "-z", "--untracked-files=all"])).toBe(true);
    expect(commandIsReadOnly(["merge-tree", "--write-tree", "--name-only", "a", "b"])).toBe(true);
    expect(commandIsReadOnly(["config", "--get", "user.name"])).toBe(true);
    expect(commandIsReadOnly(["config", "--get", "core.autocrlf"])).toBe(true);
    expect(commandIsReadOnly(["--version"])).toBe(true);
  });

  it("treats checkout, reset, stash, clean, add, and commit as mutating", () => {
    for (const command of MUTATING) {
      expect(commandIsReadOnly([command])).toBe(false);
    }
    expect(commandIsReadOnly(["merge", "--abort"])).toBe(false);
    expect(commandIsReadOnly(["rebase", "--abort"])).toBe(false);
    expect(commandIsReadOnly(["rebase", "--continue"])).toBe(false);
    expect(commandIsReadOnly(["cherry-pick", "--abort"])).toBe(false);
    expect(commandIsReadOnly(["symbolic-ref", "HEAD", "refs/heads/main"])).toBe(false);
    expect(commandIsReadOnly(["symbolic-ref", "--delete", "HEAD"])).toBe(false);
    expect(commandIsReadOnly(["config", "user.name", "Test User"])).toBe(false);
    expect(commandIsReadOnly(["config", "--unset", "core.autocrlf"])).toBe(false);
  });

  it("blocks mutating commands in the developer checkout unless a consent token is present", () => {
    for (const command of MUTATING) {
      expect(() =>
        assertNeverMutatesDeveloperCheckout({
          args: [command],
          developerCheckout: true,
        }),
      ).toThrow(DeveloperCheckoutMutationError);
    }
    expect(() =>
      assertNeverMutatesDeveloperCheckout({
        args: ["commit", "-m", "baseline"],
        developerCheckout: true,
        userExplicitConsentToken: "   ",
      }),
    ).toThrow(DeveloperCheckoutMutationError);
    expect(() =>
      assertNeverMutatesDeveloperCheckout({
        args: ["commit", "-m", "baseline"],
        developerCheckout: true,
        userExplicitConsentToken: "landing-click",
      }),
    ).not.toThrow();
    expect(() =>
      assertNeverMutatesDeveloperCheckout({
        args: ["commit", "-m", "worker"],
        developerCheckout: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertNeverMutatesDeveloperCheckout({
        args: ["status"],
        developerCheckout: true,
      }),
    ).not.toThrow();
  });

  it("refuses to override core.autocrlf and still allows reading it", () => {
    expect(isLineEndingOverride(["-c", "core.autocrlf=true", "status"])).toBe(true);
    expect(isLineEndingOverride(["-c", "core.autocrlf=false", "status"])).toBe(true);
    expect(isLineEndingOverride(["-ccore.autocrlf=input", "status"])).toBe(true);
    expect(isLineEndingOverride(["config", "core.autocrlf", "true"])).toBe(true);
    expect(isLineEndingOverride(["config", "--global", "core.autocrlf", "true"])).toBe(true);
    expect(isLineEndingOverride(["config", "--unset", "core.autocrlf"])).toBe(true);
    expect(isLineEndingOverride(["config", "--get", "core.autocrlf"])).toBe(false);
    expect(isLineEndingOverride(["status"])).toBe(false);
    expect(() => assertLineEndingsPreserved(["-c", "core.autocrlf=input", "diff"])).toThrow(
      LineEndingProtectionError,
    );
  });

  it("prefixes every Git invocation with long paths and unquoted UTF-8 paths", () => {
    expect(buildGitArgs(["status", "--porcelain=v1"])).toEqual([
      "-c",
      "core.longpaths=true",
      "-c",
      "core.quotepath=false",
      "status",
      "--porcelain=v1",
    ]);
    expect(buildGitArgs(["status"]).join(" ")).not.toContain("autocrlf");
  });
});
