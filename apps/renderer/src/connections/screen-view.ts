import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { h, NUMERIC, tone } from "./dom.js";
import type { ConnectionsViewModel, HealthRowModel } from "./model.js";
import { themeFor } from "./theme.js";

function focused(model: ConnectionsViewModel, id: string): "true" | "false" {
  return model.focusId === id ? "true" : "false";
}

function button(
  model: ConnectionsViewModel,
  id: string,
  label: string,
  attrs: Readonly<Record<string, string>>,
): ReactNode {
  return h(
    "button",
    {
      type: "button",
      "data-focus-id": id,
      "data-focused": focused(model, id),
      tabIndex: 0,
      ...attrs,
    },
    label,
  );
}

function rowView(model: ConnectionsViewModel, row: HealthRowModel): ReactNode {
  const tokens = themeFor(model.themeName);
  return h(
    "article",
    {
      "data-connection": row.id,
      "data-provider": row.provider,
      "data-auth-mode": row.authMode,
      "data-billing-badge": row.billingTypeBadge,
      "data-status": row.statusBadge,
      "data-cwnd": String(row.activeCwnd),
      "data-paused": row.paused ? "true" : "false",
      ...tone(tokens.surfaceText, tokens.surface),
    },
    h("h3", {}, row.label),
    h("p", {}, row.provider),
    h("p", { "data-field": "auth-mode" }, row.authMode),
    h("p", { "data-field": "billing" }, row.billingTypeBadge),
    h("p", { "data-field": "masked" }, row.maskedKeyOrEmail),
    h("p", { "data-field": "status" }, row.statusBadge),
    h(
      "p",
      { "data-field": "allowance", "data-numeric": "true", style: NUMERIC },
      `${row.allowanceLabel} (${Math.round(row.allowanceRatio * 100)}%)`,
    ),
    h("progress", {
      "data-field": "allowance-bar",
      max: "1",
      value: String(Math.min(1, Math.max(0, row.allowanceRatio))),
      "aria-label": row.allowanceLabel,
    }),
    h("p", { "data-field": "cwnd", "data-numeric": "true", style: NUMERIC }, `cwnd ${row.activeCwnd}`),
    row.expiryWarning ? h("p", { "data-field": "expiry" }, row.expiryWarning) : null,
    row.conformanceStatus ? h("p", { "data-field": "conformance" }, row.conformanceStatus) : null,
    row.reservePercent === null
      ? null
      : h(
          "label",
          {},
          `Keep ${row.reservePercent}% reserve for personal chats`,
          h("input", {
            type: "range",
            min: "0",
            max: "100",
            defaultValue: String(row.reservePercent),
            "aria-label": `Keep ${row.reservePercent}% reserve for personal chats`,
            "data-focus-id": `row:${row.id}:reserve`,
            "data-reserve": String(row.reservePercent),
          }),
        ),
    row.softCap === null
      ? null
      : h(
          "p",
          { "data-field": "soft-cap", "data-numeric": "true", style: NUMERIC },
          `Soft cap ${row.softCap}`,
        ),
    row.hardCap === null
      ? null
      : h(
          "p",
          { "data-field": "hard-cap", "data-numeric": "true", style: NUMERIC },
          `Hard cap ${row.hardCap}`,
        ),
    button(model, row.testFocusId, "Test", { "data-action": "test" }),
    button(model, row.refreshFocusId, "Refresh", { "data-action": "refresh" }),
    button(model, row.pauseFocusId, "Pause", { "data-action": "pause" }),
    button(model, row.removeFocusId, "Remove", { "data-action": "remove" }),
  );
}

export function ConnectionsScreenView(props: { readonly model: ConnectionsViewModel }): ReactNode {
  const { model } = props;
  const tokens = themeFor(model.themeName);
  return h(
    "main",
    {
      "data-screen": "connections",
      "data-route": model.routeId,
      "data-theme": model.themeName,
      "data-layout": model.layout,
      "aria-label": "Settings Connections",
      ...tone(tokens.text, tokens.canvas),
    },
    h("h1", {}, "Connections"),
    h(
      "section",
      { "aria-label": "Onboarding", "data-onboarding": "true" },
      ...model.cards.map((card) => button(model, card.focusId, card.title, { "data-card": card.id })),
      h(
        "label",
        {},
        "API key",
        h("input", {
          type: "password",
          autoComplete: "off",
          "aria-label": "API key",
          "data-focus-id": "key:field",
          "data-holding": model.holdingSecret ? "true" : "false",
          value: "",
          readOnly: true,
        }),
      ),
      model.detectedProvider
        ? h("p", { "data-field": "detected-provider" }, model.detectedProvider)
        : null,
      model.maskedDraft ? h("p", { "data-field": "masked-draft" }, model.maskedDraft) : null,
      button(model, "key:save", "Save key", { "data-action": "save-key" }),
    ),
    h(
      "section",
      { "aria-label": "Optional Advanced Runtimes", "data-advanced-runtimes": "true" },
      h("h2", {}, "Optional Advanced Runtimes"),
      h(
        "article",
        {
          "data-card": "gemini-cli",
          "data-enabled": model.geminiEnabled ? "true" : "false",
        },
        h("h3", {}, "Gemini CLI (ACP)"),
        h("p", { "data-invocation": model.geminiInvocation }, `Runs unmodified as ${model.geminiInvocation}`),
        h("p", { "data-compliance": model.geminiCompliance }, model.geminiNotice),
        h(
          "label",
          {},
          "I understand the Gemini CLI policy notice",
          h("input", {
            type: "checkbox",
            "data-compliance-checkbox": "gemini-cli",
            "data-checked": model.geminiNoticeAccepted ? "true" : "false",
            "aria-label": "I understand the Gemini CLI policy notice",
            "data-focus-id": "gemini:notice",
            defaultChecked: model.geminiNoticeAccepted,
          }),
        ),
        button(model, "gemini:enable", model.geminiEnabled ? "Gemini CLI on" : "Gemini CLI off", {
          "data-action": "gemini-enable",
        }),
        model.geminiBlockReason ? h("p", { "data-field": "gemini-block" }, model.geminiBlockReason) : null,
      ),
      h(
        "article",
        { "data-card": "claude-code", "data-auth": "console_api_key" },
        h("h3", {}, "Claude Code"),
        h("p", {}, model.claudeCodeNotice),
        button(model, "card:claude-code", model.claudeCodeNotice, { "data-card": "claude-code" }),
      ),
    ),
    h(
      "section",
      { "aria-label": "Connection health", "data-health-rows": "true" },
      ...model.rows.map((row) => rowView(model, row)),
    ),
    h(
      "section",
      { "aria-label": "Fallback policy", "data-fallback-policy": "true" },
      h(
        "label",
        {},
        "Never fall back to paid API keys without asking",
        h("input", {
          type: "checkbox",
          "data-never-fallback": "true",
          "data-checked": model.neverFallbackWithoutAsking ? "true" : "false",
          "aria-label": "Never fall back to paid API keys without asking",
          "data-focus-id": "policy:never-fallback",
          defaultChecked: model.neverFallbackWithoutAsking,
        }),
      ),
      model.loudWarning
        ? h("p", { "data-loud-warning": "true", role: "alert", ...tone(tokens.warningText, tokens.warning) }, model.loudWarning)
        : null,
    ),
    h(
      "section",
      { "aria-label": "Role assignment", "data-roles": "true" },
      ...model.roles.map((role) =>
        h(
          "p",
          { "data-role": role.id, "data-alias": role.id === "oracleReview" ? "Oracle Author" : role.label },
          button(
            model,
            role.focusId,
            role.connectionLabel ? `${role.label}: ${role.connectionLabel}` : role.label,
            { "data-role-button": role.id },
          ),
        ),
      ),
      model.oracleNote ? h("p", { "data-oracle-note": "true" }, model.oracleNote) : null,
      h(
        "table",
        { "data-role-matrix": "true" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, "Role"),
            ...model.rows.map((row) => h("th", { scope: "col" }, row.label)),
          ),
        ),
        h(
          "tbody",
          {},
          ...model.roles.map((role) =>
            h(
              "tr",
              { "data-matrix-role": role.id },
              h("th", { scope: "row" }, role.id === "oracleReview" ? "Oracle Author" : role.label),
              ...model.rows.map((row) =>
                h(
                  "td",
                  {
                    "data-connection": row.id,
                    "data-pinned": role.connectionId === row.id ? "true" : "false",
                  },
                  role.connectionId === row.id ? "Pinned" : "Open",
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    model.banner ? h("p", { role: "alert", "data-banner": "true" }, model.banner) : null,
    model.resumeBlocked ? h("p", { "data-resume-blocked": "true" }, "Resume is blocked") : null,
    model.drawer
      ? h(
          "aside",
          { "data-drawer": "test-connection", "aria-label": "Test connection" },
          h("h2", {}, model.drawer.kind === "conformance" ? "CLI conformance check" : "Zero-token probe"),
          h("p", { "data-field": "latency", "data-numeric": "true", style: NUMERIC }, `${model.drawer.latencyMs} ms`),
          h(
            "p",
            { "data-field": "models", "data-numeric": "true", style: NUMERIC },
            `${model.drawer.discoveredModelCount} models`,
          ),
          h("p", { "data-field": "diagnostic", "data-focus-id": "drawer:diagnostic" }, model.drawer.diagnostic),
        )
      : null,
    model.stopCard
      ? h(
          "aside",
          { "data-stop-card": "checkpoint", role: "alertdialog", "aria-label": "Checkpoint stop" },
          h("h2", {}, "Checkpoint stop"),
          h("p", {}, model.stopCard.message),
          h("p", { "data-field": "cost-estimate", "data-numeric": "true", style: NUMERIC }, model.stopCard.costEstimate),
          button(model, "stop:consent", model.stopCard.action, { "data-action": "switch-connection" }),
        )
      : null,
  );
}

export function renderConnectionsHtml(model: ConnectionsViewModel): string {
  return renderToStaticMarkup(ConnectionsScreenView({ model })).replaceAll(
    "autoComplete=",
    "autocomplete=",
  );
}
