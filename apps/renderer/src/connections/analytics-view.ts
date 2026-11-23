import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalyticsModel, UsageTab } from "./analytics.js";
import { h, NUMERIC, tone } from "./dom.js";
import { DARK_THEME, LIGHT_THEME } from "./theme.js";

const TABS: readonly { readonly id: UsageTab; readonly label: string }[] = [
  { id: "api", label: "API Connections" },
  { id: "subscription", label: "Subscription Windows" },
  { id: "local", label: "Local Models" },
];

function tokensFor(theme: "light" | "dark") {
  return theme === "dark" ? DARK_THEME : LIGHT_THEME;
}

export function AnalyticsScreenView(props: {
  readonly model: AnalyticsModel;
  readonly themeName?: "light" | "dark";
}): ReactNode {
  const themeName = props.themeName ?? "light";
  const tokens = tokensFor(themeName);
  const { model } = props;
  return h(
    "main",
    {
      "data-screen": "usage",
      "data-route": model.routeId,
      "data-currency-separated": "true",
      "data-active-tab": model.activeTab,
      "aria-label": "Usage and billing",
      ...tone(tokens.text, tokens.canvas),
    },
    h("h1", {}, "Usage and billing"),
    h(
      "div",
      { role: "tablist", "aria-label": "Usage currencies" },
      ...TABS.map((tab) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            "data-tab": tab.id,
            "aria-selected": model.activeTab === tab.id ? "true" : "false",
          },
          tab.label,
        ),
      ),
    ),
    h(
      "section",
      { "data-panel": "api", "aria-label": "API Connections" },
      h("h2", {}, "API Connections"),
      h("p", { "data-badge": "estimated" }, model.api.estimated.badge),
      h(
        "p",
        { "data-numeric": "true", "data-estimated-micro-usd": String(model.api.estimated.microUsd), style: NUMERIC },
        `${model.api.estimated.microUsd} micro-USD`,
      ),
      h(
        "p",
        { "data-tokens": "estimated" },
        `in ${model.api.estimated.inputTokens} cached ${model.api.estimated.cachedTokens} out ${model.api.estimated.outputTokens} reasoning ${model.api.estimated.reasoningTokens}`,
      ),
      h("p", { "data-badge": "reported" }, model.api.reported.badge),
      h(
        "p",
        { "data-numeric": "true", "data-reported-micro-usd": String(model.api.reported.microUsd), style: NUMERIC },
        `${model.api.reported.microUsd} micro-USD`,
      ),
      h(
        "p",
        {
          "data-phase": "coding",
          "data-met": model.api.phase.codingMeetsTarget ? "true" : "false",
          "data-share-bps": String(model.api.phase.codingShareBps),
        },
        model.api.phase.codingLabel,
      ),
      h(
        "p",
        {
          "data-phase": "paperwork",
          "data-met": model.api.phase.paperworkMeetsTarget ? "true" : "false",
          "data-share-bps": String(model.api.phase.paperworkShareBps),
        },
        model.api.phase.paperworkLabel,
      ),
      h(
        "ul",
        { "data-groups": "project" },
        ...model.api.groups.byProject.map((group) =>
          h("li", { "data-key": group.key, "data-source": group.pricingSource }, `${group.key} ${group.microUsd}`),
        ),
      ),
      h(
        "ul",
        { "data-groups": "feature" },
        ...model.api.groups.byFeature.map((group) => h("li", { "data-key": group.key }, group.key)),
      ),
      h(
        "ul",
        { "data-groups": "phase" },
        ...model.api.groups.byPhase.map((group) => h("li", { "data-key": group.key }, group.key)),
      ),
      h(
        "ul",
        { "data-groups": "model" },
        ...model.api.groups.byModel.map((group) => h("li", { "data-key": group.key }, group.key)),
      ),
    ),
    h(
      "section",
      { "data-panel": "subscription", "aria-label": "Subscription Windows" },
      h("h2", {}, "Subscription Windows"),
      ...model.subscription.windows.map((window) =>
        h(
          "p",
          {
            "data-window": window.kind,
            "data-model": window.model,
            "data-ratio": String(window.ratio),
            "data-numeric": "true",
            style: NUMERIC,
          },
          `${window.kind} ${window.percent} ${window.countdown} k[${window.model}]=${window.kModel}`,
        ),
      ),
      h(
        "p",
        { "data-premium-requests": String(model.subscription.premiumRequests), "data-numeric": "true", style: NUMERIC },
        `Premium requests ${model.subscription.premiumRequests}`,
      ),
    ),
    h(
      "section",
      { "data-panel": "local", "aria-label": "Local Models" },
      h("h2", {}, "Local Models"),
      h("p", { "data-local-tokens": String(model.local.tokens), "data-numeric": "true", style: NUMERIC }, `${model.local.tokens} tokens`),
      h(
        "p",
        { "data-tok-per-sec": String(model.local.averageTokPerSec), "data-numeric": "true", style: NUMERIC },
        `${model.local.averageTokPerSec} tok/s`,
      ),
      h("p", { "data-gpu-ms": String(model.local.gpuMs), "data-numeric": "true", style: NUMERIC }, `${model.local.gpuMs} ms GPU`),
      h("p", { "data-cloud-spend": model.local.cloudSpend, "data-cloud-micro-usd": "0" }, `${model.local.cloudSpend} cloud spend`),
    ),
    h(
      "table",
      {
        "data-panel": "receipts",
        "data-receipts": "true",
        "data-rendered-rows": String(model.receipts.rendered.length),
        "data-total-rows": String(model.receipts.total),
      },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...[
            "timestamp",
            "project",
            "taskId",
            "role",
            "connection",
            "model",
            "inputTokens",
            "cachedTokens",
            "outputTokens",
            "costOrWindowDelta",
            "pricingSource",
          ].map((column) => h("th", { scope: "col" }, column)),
        ),
      ),
      h(
        "tbody",
        {},
        ...model.receipts.rendered.map((row) =>
          h(
            "tr",
            { "data-task": row.taskId },
            h("td", {}, row.timestamp),
            h("td", {}, row.project),
            h("td", {}, row.taskId),
            h("td", {}, row.role),
            h("td", {}, row.connection),
            h("td", {}, row.model),
            h("td", { "data-numeric": "true", style: NUMERIC }, String(row.inputTokens)),
            h("td", { "data-numeric": "true", style: NUMERIC }, String(row.cachedTokens)),
            h("td", { "data-numeric": "true", style: NUMERIC }, String(row.outputTokens)),
            h("td", { "data-numeric": "true", style: NUMERIC }, row.costOrWindowDelta),
            h("td", {}, row.pricingSource),
          ),
        ),
      ),
    ),
  );
}

export function renderAnalyticsHtml(model: AnalyticsModel, themeName: "light" | "dark" = "light"): string {
  return renderToStaticMarkup(AnalyticsScreenView({ model, themeName }));
}
