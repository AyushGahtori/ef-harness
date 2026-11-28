import type { ReactNode } from "react";
import { focusedOutline, h, tone } from "./dom.js";
import { governorColors } from "./theme.js";
import { PHASES, type ShellViewModel } from "./types.js";

function levelLabel(level: ShellViewModel["governor"]["level"]): string {
  if (level === "green") return "Green";
  if (level === "yellow") return "Yellow";
  if (level === "orange") return "Orange";
  return "Red";
}

export function FixedTopBar(props: { model: ShellViewModel }): ReactNode {
  const { model } = props;
  const governor = governorColors(model.governor.level, model.tokens);
  const governorName = levelLabel(model.governor.level);
  const focusRing = model.tokens.focusRing;
  return h(
    "header",
    {
      ...tone(model.tokens.topBarText, model.tokens.topBar, { minHeight: "48px" }),
      "data-zone": "topbar",
      "data-height": "48",
      "data-connection": model.connection,
    },
    h(
      "button",
      {
        type: "button",
        "data-command": "toggle-project-menu",
        "aria-haspopup": "listbox",
        "aria-expanded": model.projectMenuOpen ? "true" : "false",
        "aria-label": `Project ${model.project.name}, branch ${model.project.branch}`,
        "data-focused": model.focusId === "project-switcher" ? "true" : "false",
        style: {
          ...focusedOutline(model.keyboardModality && model.focusId === "project-switcher", focusRing),
        },
      },
      model.project.name,
      h(
        "span",
        { "data-role": "branch-badge" },
        model.project.branch,
      ),
    ),
    model.projectMenuOpen
      ? h(
          "ul",
          { role: "listbox", "aria-label": "Projects" },
          ...model.projects.map((project) =>
            h(
              "li",
              { key: project.id, role: "option", "aria-selected": project.id === model.project.id ? "true" : "false" },
              h(
                "button",
                {
                  type: "button",
                  "data-command": `project:${project.id}`,
                  "aria-label": `Open ${project.name} in a window`,
                },
                project.name,
              ),
            ),
          ),
        )
      : null,
    h(
      "nav",
      { "aria-label": "Phases" },
      ...PHASES.map((phase) =>
        h(
          "button",
          {
            type: "button",
            "data-command": `phase:${phase.id}`,
            "aria-pressed": model.phase === phase.id ? "true" : "false",
            "aria-label": `${phase.label} phase`,
            "data-focused": model.focusId === `phase-${phase.id}` ? "true" : "false",
            style: focusedOutline(model.keyboardModality && model.focusId === `phase-${phase.id}`, focusRing),
          },
          phase.label,
        ),
      ),
    ),
    h(
      "span",
      {
        ...tone(governor.fg, governor.bg),
        id: "governor-pill",
        role: "status",
        "aria-live": "polite",
        "aria-label": `Hardware governor ${governorName}. ${model.governor.driver}`,
        title: model.governor.driver,
        "data-level": model.governor.level,
      },
      governorName,
    ),
    h(
      "button",
      {
        type: "button",
        id: "spend-meter",
        "data-command": "toggle-spend",
        "aria-live": "polite",
        "aria-expanded": model.spendOpen ? "true" : "false",
        "aria-label": `Spend ${model.spendPrimary}`,
        ...tone(model.tokens.text, model.tokens.topBar),
      },
      model.spendPrimary,
    ),
    model.spendOpen
      ? h(
          "div",
          { role: "dialog", "aria-label": "Spend breakdown", "data-popover": "spend" },
          ...model.spendLines.map((line) => h("p", { key: line }, line)),
        )
      : null,
    h(
      "button",
      {
        type: "button",
        "data-command": "toggle-focus",
        "aria-pressed": model.focusMode ? "true" : "false",
        "aria-label": "Focus mode",
      },
      "Focus",
    ),
    h(
      "button",
      {
        type: "button",
        "data-command": "open-settings",
        "aria-label": "Connections and settings",
        "aria-expanded": model.settingsOpen ? "true" : "false",
      },
      "Connections",
    ),
    h(
      "button",
      {
        type: "button",
        "data-command": "pause",
        "aria-label": "Pause",
        disabled: model.pauseEnabled ? undefined : true,
        "data-enabled": model.pauseEnabled ? "true" : "false",
        ...tone(model.tokens.pauseFg, model.tokens.pauseBg),
      },
      "Pause",
    ),
    h(
      "button",
      {
        type: "button",
        id: "topbar-stop",
        "data-command": "stop",
        "data-fixed": "true",
        "data-zone": "stop",
        "aria-label": "Stop",
        disabled: model.stopEnabled ? undefined : true,
        "data-enabled": model.stopEnabled ? "true" : "false",
        ...tone(model.tokens.stopFg, model.tokens.stopBg, { fontWeight: 700 }),
        style: {
          color: model.tokens.stopFg,
          backgroundColor: model.tokens.stopBg,
          fontWeight: 700,
          ...focusedOutline(model.keyboardModality && model.focusId === "topbar-stop", focusRing),
        },
      },
      "Stop",
    ),
    h(
      "button",
      {
        type: "button",
        "data-command": "resume",
        "aria-label": "Resume",
        disabled: model.resumeEnabled ? undefined : true,
        "data-enabled": model.resumeEnabled ? "true" : "false",
        ...tone(model.tokens.resumeFg, model.tokens.resumeBg),
      },
      "Resume",
    ),
    model.connection === "reconnecting"
      ? h(
          "div",
          { id: "reconnecting-banner", role: "status", "aria-live": "polite" },
          "Reconnecting to harnessd...",
        )
      : null,
    model.stopConfirmOpen
      ? h(
          "div",
          { role: "dialog", "aria-modal": "true", "aria-label": "Confirm stop", "data-popover": "stop-confirm" },
          h("p", {}, "Stop the build? Checkpoints stay saved."),
          h(
            "button",
            { type: "button", "data-command": "confirm-stop", "aria-label": "Confirm stop" },
            "Confirm stop",
          ),
          h(
            "button",
            { type: "button", "data-command": "cancel-stop", "aria-label": "Cancel stop" },
            "Cancel",
          ),
        )
      : null,
    model.settingsOpen
      ? h(
          "div",
          { role: "dialog", "aria-modal": "true", "aria-label": "Connections and settings", "data-popover": "settings" },
          h("p", {}, "Connections and settings open in this window."),
        )
      : null,
    h(
      "div",
      { role: "radiogroup", "aria-label": "Theme" },
      ...(["light", "dark", "system"] as const).map((preference) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            "data-command": `theme:${preference}`,
            "aria-checked": model.themePreference === preference ? "true" : "false",
            "aria-label": `${preference} theme`,
          },
          preference,
        ),
      ),
    ),
  );
}
