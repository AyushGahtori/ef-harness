import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CurrencyCodeSchema,
  IntegerUnitError,
  PERCENT_TO_PPM_FACTOR,
  USD_MICRO_SCALE,
  WINDOW_SHARE_PPM_SCALE,
  isCurrencyCode,
  microUnitsToUsdDisplay,
  percentToPpm,
  ppmToPercentDisplay,
  usdToMicroUnits,
} from "../../src/vocabularies/index.js";

function rejection(run: () => void): IntegerUnitError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IntegerUnitError);
    if (error instanceof IntegerUnitError) return error;
  }
  throw new Error("expected IntegerUnitError");
}

describe("integer currency and ppm converters", () => {
  it("uses one million units for micro-USD and a full window share", () => {
    expect(USD_MICRO_SCALE).toBe(1_000_000);
    expect(WINDOW_SHARE_PPM_SCALE).toBe(1_000_000);
    expect(100 * PERCENT_TO_PPM_FACTOR).toBe(WINDOW_SHARE_PPM_SCALE);
    expect(isCurrencyCode("usd")).toBe(true);
    expect(isCurrencyCode("slots:local")).toBe(true);
    expect(isCurrencyCode("allowance:chatgpt-personal")).toBe(true);
    expect(CurrencyCodeSchema.safeParse("allowance:openrouter-key-1").success).toBe(true);
    expect(isCurrencyCode("allowance:")).toBe(false);
    expect(isCurrencyCode("eur")).toBe(false);
  });

  it("parses the decimal edge cases without binary floating point", () => {
    expect(usdToMicroUnits("0.1")).toBe(100_000);
    expect(usdToMicroUnits("$10.00")).toBe(10_000_000);
    expect(usdToMicroUnits("0.10") + usdToMicroUnits("0.10") + usdToMicroUnits("0.10")).toBe(
      300_000,
    );
    expect(usdToMicroUnits("0.1") + usdToMicroUnits("0.2")).toBe(300_000);
    expect(usdToMicroUnits("0.3")).toBe(300_000);
    expect(usdToMicroUnits("1e-6")).toBe(1);
    expect(usdToMicroUnits("1e1")).toBe(10_000_000);
    expect(usdToMicroUnits("9007199254.740991")).toBe(Number.MAX_SAFE_INTEGER);

    const subMicro = rejection(() => usdToMicroUnits("0.0000009"));
    expect(subMicro.code).toBe("sub_unit");
    expect(subMicro.message).toContain("sub-micro precision overflow");

    const scientific = rejection(() => usdToMicroUnits("1e-7"));
    expect(scientific.code).toBe("sub_unit");
    expect(scientific.message).toContain("sub-micro precision overflow");

    const negative = rejection(() => usdToMicroUnits("-5"));
    expect(negative.code).toBe("negative");
    expect(rejection(() => usdToMicroUnits("-0")).code).toBe("negative");
    expect(rejection(() => usdToMicroUnits("-0.00")).code).toBe("negative");
    expect(rejection(() => usdToMicroUnits("9007199254.740992")).code).toBe("overflow");
    expect(rejection(() => usdToMicroUnits("1e20")).code).toBe("overflow");
    expect(rejection(() => usdToMicroUnits("not-a-number")).code).toBe("invalid_format");
    expect(rejection(() => usdToMicroUnits("1_000")).code).toBe("invalid_format");
  });

  it("converts percent strings to window-share ppm exactly", () => {
    expect(percentToPpm("100")).toBe(1_000_000);
    expect(percentToPpm("1")).toBe(10_000);
    expect(percentToPpm("0.0001")).toBe(1);
    expect(percentToPpm("0.1") + percentToPpm("0.2")).toBe(percentToPpm("0.3"));
    expect(percentToPpm("0.10") + percentToPpm("0.10") + percentToPpm("0.10")).toBe(3_000);
    expect(percentToPpm("1e-4")).toBe(1);
    expect(ppmToPercentDisplay(1)).toBe("0.0001");
    expect(ppmToPercentDisplay(10_000)).toBe("1");
    expect(ppmToPercentDisplay(1_000_000)).toBe("100");
    expect(rejection(() => percentToPpm("0.00001")).code).toBe("sub_unit");
    expect(rejection(() => percentToPpm("1e-5")).message).toContain("sub-ppm precision overflow");
    expect(rejection(() => percentToPpm("-5")).code).toBe("negative");
    expect(rejection(() => percentToPpm("$10")).code).toBe("invalid_format");
  });

  it("round-trips micro-USD and ppm through exact integer arithmetic", () => {
    expect(microUnitsToUsdDisplay(300_000)).toBe("0.3");
    expect(usdToMicroUnits(microUnitsToUsdDisplay(300_000))).toBe(300_000);
    expect(microUnitsToUsdDisplay(1)).toBe("0.000001");
    expect(microUnitsToUsdDisplay(0)).toBe("0");
    expect(rejection(() => microUnitsToUsdDisplay(1.5)).code).toBe("invalid_format");
    expect(rejection(() => microUnitsToUsdDisplay(-1)).code).toBe("negative");
    expect(rejection(() => ppmToPercentDisplay(Number.NaN)).code).toBe("invalid_format");

    for (let micro = 0; micro <= 2_000; micro += 1) {
      expect(usdToMicroUnits(microUnitsToUsdDisplay(micro))).toBe(micro);
    }

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_000 }), (micro) => {
        expect(usdToMicroUnits(microUnitsToUsdDisplay(micro))).toBe(micro);
        expect(microUnitsToUsdDisplay(micro)).not.toMatch(/e/iu);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (ppm) => {
        expect(percentToPpm(ppmToPercentDisplay(ppm))).toBe(ppm);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 999_999 }),
        (dollars, micros) => {
          const text = `${dollars}.${micros.toString().padStart(6, "0")}`;
          expect(usdToMicroUnits(text)).toBe(dollars * USD_MICRO_SCALE + micros);
        },
      ),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        (first, second, third) => {
          const sum =
            usdToMicroUnits(microUnitsToUsdDisplay(first)) +
            usdToMicroUnits(microUnitsToUsdDisplay(second)) +
            usdToMicroUnits(microUnitsToUsdDisplay(third));
          expect(sum).toBe(first + second + third);
        },
      ),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999 }),
        fc.integer({ min: 1, max: 9 }),
        (micros, extra) => {
          const text = `0.${micros.toString().padStart(6, "0")}${extra}`;
          expect(rejection(() => usdToMicroUnits(text)).code).toBe("sub_unit");
        },
      ),
      { numRuns: 50 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (whole) => {
        expect(rejection(() => usdToMicroUnits(`-${whole}.01`)).code).toBe("negative");
        expect(rejection(() => percentToPpm(`-${whole}`)).code).toBe("negative");
      }),
      { numRuns: 50 },
    );
  });
});
