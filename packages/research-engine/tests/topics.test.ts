import { describe, expect, it } from "vitest";
import { RiskTriggeredTopicGenerator } from "../src/public.js";

describe("RiskTriggeredTopicGenerator", () => {
  it("filters language basics and keeps high-risk topics inside the 3% cap", () => {
    const plan = new RiskTriggeredTopicGenerator().generate({
      stack: [
        { name: "next", version: "15.0.0" },
        { name: "prisma", version: "6.1.0" },
      ],
      budget: { waveTokenBudget: 100_000, tokensPerTopic: 100 },
      signals: [
        {
          id: "basics",
          title: "Array helpers",
          text: "use array map and console.log",
          riskTags: [],
        },
        {
          id: "loops",
          title: "Loops",
          text: "a for loop and string concatenation",
          kindHint: "language_basic",
        },
        {
          id: "stripe-major",
          title: "stripe major API",
          libraryName: "stripe",
          fromVersion: "16.4.0",
          toVersion: "18.0.0",
        },
        {
          id: "hooks",
          title: "Stripe webhooks",
          text: "webhook signature verification",
          libraryName: "stripe",
          riskTags: ["webhook"],
          kindHint: "service",
        },
        {
          id: "oauth",
          title: "OAuth code flow",
          text: "OAuth authorization code and token exchange",
          riskTags: ["oauth"],
        },
        {
          id: "win",
          title: "Windows spooler binding",
          text: "Windows API native binding via node-gyp",
          kindHint: "native",
          riskTags: ["windows", "native"],
        },
        {
          id: "prisma-quirk",
          title: "Prisma driver lock",
          libraryName: "prisma",
          text: "ORM migration lock on the query driver",
          kindHint: "database",
          riskTags: ["orm"],
        },
        {
          id: "csrf",
          title: "CSRF primitive",
          text: "CSRF token rotation for compliance",
          kindHint: "security",
          riskTags: ["security", "compliance"],
        },
      ],
    });

    expect(plan.tokenCap).toBe(3_000);
    expect(plan.topics.filter((topic) => topic.id === "stack-compatibility")).toHaveLength(1);
    expect(plan.skipped.map((topic) => topic.id).sort()).toEqual(["basics", "loops"]);
    expect(plan.selected.map((topic) => topic.id)).not.toContain("basics");
    expect(plan.selected.map((topic) => topic.id)).not.toContain("loops");
    expect(plan.topics.find((topic) => topic.id === "stripe-major")?.kind).toBe("major_version_api");
    expect(plan.topics.find((topic) => topic.id === "hooks")?.kind).toBe("saas_webhook_oauth");
    expect(plan.topics.find((topic) => topic.id === "oauth")?.kind).toBe("saas_webhook_oauth");
    expect(plan.topics.find((topic) => topic.id === "win")?.kind).toBe("windows_native");
    expect(plan.topics.find((topic) => topic.id === "prisma-quirk")?.kind).toBe("db_driver_orm");
    expect(plan.topics.find((topic) => topic.id === "csrf")?.kind).toBe("security_compliance");
    expect(plan.selected.every((topic) => topic.disposition === "selected")).toBe(true);
  });

  it("ranks 15 topics by risk and defers the rest when the 3% envelope is full", () => {
    const signals = [
      ...["sec-a", "sec-b", "sec-c"].map((id) => ({
        id,
        title: `Security ${id}`,
        text: "CSRF compliance control",
        riskTags: ["security"],
        kindHint: "security" as const,
        docUrl: `https://nodejs.org/api/${id}`,
      })),
      ...["hook-a", "hook-b", "hook-c"].map((id) => ({
        id,
        title: `Webhook ${id}`,
        text: "webhook signature",
        riskTags: ["webhook"],
        kindHint: "service" as const,
        docUrl: `https://nodejs.org/api/${id}`,
      })),
      ...["api-a", "api-b", "api-c"].map((id) => ({
        id,
        title: `Upgrade ${id}`,
        libraryName: "stripe",
        fromVersion: "16.4.0",
        toVersion: "18.0.0",
        docUrl: `https://nodejs.org/api/${id}`,
      })),
      ...["win-a", "win-b", "win-c"].map((id) => ({
        id,
        title: `Native ${id}`,
        text: "Windows API native binding",
        kindHint: "native" as const,
        riskTags: ["windows"],
        docUrl: `https://nodejs.org/api/${id}`,
      })),
      ...["db-a", "db-b", "db-c"].map((id) => ({
        id,
        title: `Driver ${id}`,
        libraryName: "prisma",
        text: "ORM query driver quirk",
        kindHint: "database" as const,
        riskTags: ["db"],
        docUrl: `https://nodejs.org/api/${id}`,
      })),
    ];
    const plan = new RiskTriggeredTopicGenerator().generate({
      signals,
      budget: { waveTokenBudget: 10_000, tokensPerTopic: 100 },
    });

    expect(signals).toHaveLength(15);
    expect(plan.tokenCap).toBe(300);
    expect(plan.selected).toHaveLength(3);
    expect(plan.selected.map((topic) => topic.id).sort()).toEqual(["sec-a", "sec-b", "sec-c"]);
    expect(plan.deferred).toHaveLength(12);
    expect(plan.deferred.every((topic) => topic.disposition === "deferred_to_installed_types")).toBe(true);
    expect(plan.tokensReserved).toBe(300);
    expect(plan.skipped).toHaveLength(0);
  });
});
