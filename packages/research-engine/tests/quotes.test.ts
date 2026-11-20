import { describe, expect, it } from "vitest";
import { TokenBasedQuoteMatcher } from "../src/public.js";

const source =
  "The payment_method field is required for createPaymentIntent. Pass --confirm and stripe@16.4.";

describe("TokenBasedQuoteMatcher", () => {
  const matcher = new TokenBasedQuoteMatcher();

  it("accepts a whitespace-normalized verbatim quote", () => {
    const quote =
      "The   payment_method\n\nfield is required for createPaymentIntent.   Pass --confirm and stripe@16.4.";
    const match = matcher.match(quote, source);
    expect(match.accepted).toBe(true);
    expect(match.flag).toBe("verified");
    expect(match.alignment).toBe(1);
  });

  it("rejects a quote that changes required to optional", () => {
    const match = matcher.match(
      "The payment_method field is optional for createPaymentIntent. Pass --confirm and stripe@16.4.",
      source,
    );
    expect(match.accepted).toBe(false);
    expect(match.flag).toBe("unverified_quote");
    expect(match.status).toBe("altered_keyword");
  });

  it("rejects a polarity keyword swap even when 95% of tokens still align", () => {
    const words = Array.from({ length: 19 }, (_, index) => `token${index}`);
    const match = matcher.match([...words, "optional"].join(" "), [...words, "required"].join(" "));
    expect(match.alignment).toBeGreaterThanOrEqual(0.95);
    expect(match.accepted).toBe(false);
    expect(match.status).toBe("altered_keyword");
    expect(match.flag).toBe("unverified_quote");
  });

  it("rejects altered flags, version numbers, and method names", () => {
    expect(
      matcher.match(
        "The payment_method field is required for createPaymentIntent. Pass --capture and stripe@16.4.",
        source,
      ).status,
    ).toBe("fabricated_flag");
    expect(
      matcher.match(
        "The payment_method field is required for createPaymentIntent. Pass --confirm and stripe@18.0.",
        source,
      ).status,
    ).toBe("fabricated_version");
    expect(
      matcher.match(
        "The payment_method field is required for createCharge. Pass --confirm and stripe@16.4.",
        source,
      ).status,
    ).toBe("fabricated_method");
  });

  it("flags a quote that is absent from the fetched page", () => {
    const match = matcher.match("totally different sentence about another api", source);
    expect(match.accepted).toBe(false);
    expect(match.flag).toBe("unverified_quote");
  });
});
