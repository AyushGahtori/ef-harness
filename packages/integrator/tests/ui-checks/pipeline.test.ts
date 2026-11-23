import { describe, expect, it } from "vitest";

import { UiConsistencyPipeline } from "../../src/ui-checks/ui-consistency-pipeline.js";
import {
  COMPLIANT_FILES,
  COMPLIANT_ROUTE_AUDITS,
  COMPLIANT_RHYTHM,
  compliantScreenshot,
} from "./fixtures.js";

describe("UiConsistencyPipeline compliant fixture", () => {
  it("passes all six stages on a compliant multi-screen app", async () => {
    const pipeline = new UiConsistencyPipeline();
    const result = await pipeline.run({
      projectKind: "ui",
      darkModeEnabled: true,
      files: COMPLIANT_FILES,
      routeAudits: COMPLIANT_ROUTE_AUDITS,
      rhythmMetrics: COMPLIANT_RHYTHM,
      screenshots: [
        {
          route: "/orders",
          viewportId: "desktop",
          theme: "light",
          actual: compliantScreenshot(),
        },
      ],
      tasteReviewBudgetOk: true,
    });
    expect(result.status).toBe("passed");
    expect(result.stages).toHaveLength(6);
    expect(result.stages.every((stage) => stage.passed)).toBe(true);
    expect(result.tasteReview?.status).toBe("advisory_sent");
  });
});