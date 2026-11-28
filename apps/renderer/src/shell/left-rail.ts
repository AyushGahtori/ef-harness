import type { ReactNode } from "react";
import { h, tone } from "./dom.js";
import { visibleInbox } from "./format.js";
import type { ShellSlotRegistry, ShellViewModel } from "./types.js";

export function CollapsibleLeftRail(props: {
  model: ShellViewModel;
  slots: ShellSlotRegistry;
}): ReactNode {
  const { model, slots } = props;
  const items = visibleInbox(model.inbox, model.railFilter);
  const inbox = slots.inbox ? slots.inbox.render(model) : null;
  return h(
    "aside",
    {
      ...tone(model.tokens.text, model.tokens.railBg),
      "aria-label": "Chat and inbox",
      "data-zone": "left-rail",
      "data-collapsed": model.layout.leftCollapsed ? "true" : "false",
      "data-width": String(model.layout.leftWidthPx),
      "data-requested-width": String(model.leftRequestedWidthPx),
      "aria-expanded": model.layout.leftCollapsed ? "false" : "true",
    },
    h(
      "button",
      {
        type: "button",
        "data-command": "toggle-left",
        "aria-expanded": model.layout.leftCollapsed ? "false" : "true",
        "aria-controls": "left-rail-body",
        "aria-label": model.layout.leftCollapsed ? "Expand chat and inbox" : "Collapse chat and inbox",
      },
      model.layout.leftCollapsed ? "Expand" : "Collapse",
    ),
    h(
      "span",
      {
        "data-role": "unread-badge",
        "aria-label": `${model.unreadCount} unread`,
      },
      String(model.unreadCount),
    ),
    h(
      "div",
      {
        id: "left-rail-body",
        role: "region",
        "aria-label": "Inbox filters",
        "data-scroll-region": "left-rail",
        tabIndex: 0,
        "data-scroll-top": String(model.leftScrollTop),
        hidden: model.layout.leftCollapsed ? true : undefined,
      },
      h(
        "div",
        { role: "tablist", "aria-label": "Inbox filter" },
        h(
          "button",
          {
            type: "button",
            role: "tab",
            "data-command": "filter:all",
            "aria-selected": model.railFilter === "all" ? "true" : "false",
            "aria-label": "All",
          },
          "All",
        ),
        h(
          "button",
          {
            type: "button",
            role: "tab",
            "data-command": "filter:needs-you",
            "aria-selected": model.railFilter === "needs-you" ? "true" : "false",
            "aria-label": `Needs You (${model.needsYouCount})`,
          },
          `Needs You (${model.needsYouCount})`,
        ),
        h(
          "button",
          {
            type: "button",
            role: "tab",
            "data-command": "filter:chat",
            "aria-selected": model.railFilter === "chat" ? "true" : "false",
            "aria-label": "Chat",
          },
          "Chat",
        ),
      ),
      inbox,
      h(
        "ul",
        { "aria-label": "Inbox items" },
        ...items.map((item) =>
          h(
            "li",
            { key: item.id, "data-bucket": item.bucket, "data-unread": item.unread ? "true" : "false" },
            item.title,
          ),
        ),
      ),
    ),
    h(
      "form",
      {
        ...tone(model.tokens.composerText, model.tokens.composerBg),
        "aria-label": "Composer",
        "data-zone": "composer",
        "data-draft": model.composerDraft,
        "data-dictating": model.dictating ? "true" : "false",
      },
      h("span", { "data-role": "composer-target" }, model.composerTarget),
      h("input", {
        id: "composer-input",
        type: "text",
        "aria-label": "Message",
        value: model.composerDraft,
        "data-focused": model.focusId === "composer-input" ? "true" : "false",
      }),
      h(
        "button",
        {
          type: "button",
          "data-command": "dictate",
          "aria-pressed": model.dictating ? "true" : "false",
          "aria-label": "Dictate",
        },
        "Mic",
      ),
      h(
        "button",
        {
          type: "button",
          "data-command": "send-composer",
          "aria-label": "Send",
          disabled: model.sendEnabled ? undefined : true,
          "data-enabled": model.sendEnabled ? "true" : "false",
        },
        "Send",
      ),
    ),
  );
}
