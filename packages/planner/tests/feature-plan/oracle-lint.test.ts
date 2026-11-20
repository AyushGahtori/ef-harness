import { describe, expect, it } from "vitest";

import { lintOracleCase } from "../../src/feature-plan/index.js";

describe("oracle lint and public-contract addressing", () => {
  it("rejects tautologies, missing assertions, clocks, sleeps, and timers", () => {
    expect(codes("expect(true).toBe(true)")).toContain("tautology");
    expect(codes("expect(res.status).toBeDefined()")).toContain("tautology");
    expect(codes("const value = 1")).toContain("zero_assertions");
    expect(codes("expect(Date.now()).toBe(1)")).toContain("flaky_clock");
    expect(codes("await sleep(5000); expect(res.status).toBe(201)")).toContain("flaky_sleep");
    expect(codes("setTimeout(3000); expect(res.status).toBe(201)")).toContain("flaky_timer");
  });

  it("rejects live external urls and allows loopback", () => {
    expect(codes("expect(fetch('https://api.stripe.com/v1/charges').status).toBe(200)")).toContain("live_network");
    const loopback = lintOracleCase({
      assertion: "expect(res.status).toBe(200)",
      input: "http://127.0.0.1:4010/hooks/stripe",
      expected: "200",
      entryPoint: "POST /api/orders",
      kind: "api",
    });
    expect(loopback.map((issue) => issue.code)).not.toContain("live_network");
  });

  it("rejects private paths and tailwind selectors", () => {
    expect(codes("expect(read('src/orders/internal/calc.ts')).toBe(1)")).toContain("private_path");
    expect(
      codes("expect(screen.getByClassName('bg-blue-500')).toBeVisible()", "ui"),
    ).toContain("tailwind_selector");
  });

  it("requires semantic ui hooks and canonical api routes", () => {
    expect(codes("expect(screen.getByText('Save')).toBeVisible()", "ui")).toContain("public_contract");
    expect(
      lintOracleCase({
        assertion: "expect(res.body).toEqual({ ok: true })",
        input: "{}",
        expected: "ok",
        entryPoint: "orders",
        kind: "api",
      }).map((issue) => issue.code),
    ).toContain("public_contract");
    expect(
      lintOracleCase({
        assertion: "expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('Saved')",
        input: "submit form",
        expected: "Saved",
        entryPoint: "role=button[name=Save]",
        kind: "ui",
      }),
    ).toEqual([]);
    expect(
      lintOracleCase({
        assertion: "expect(res.status).toBe(422)",
        input: '{"at":"11:01"}',
        expected: "422",
        entryPoint: "POST /api/orders",
        kind: "api",
      }),
    ).toEqual([]);
  });
});

function codes(assertion: string, kind: "api" | "ui" | "unit" = "api"): string[] {
  return lintOracleCase({
    assertion,
    input: '{"amount":1}',
    expected: "201",
    entryPoint: kind === "ui" ? "button" : "POST /api/orders",
    kind,
  }).map((issue) => issue.code);
}
