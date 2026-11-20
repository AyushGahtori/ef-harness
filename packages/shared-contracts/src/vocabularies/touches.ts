import { z } from "zod";
import { isOneOf } from "./closed-enum.js";

/**
 * Closed touches registry: 28 tags in 7 groups.
 * Group labels and tag order follow the corpus table.
 */
export const TOUCHES_TAG_GROUPS = [
  {
    group: "Data sensitivity",
    tags: ["personal_data", "credentials", "money", "user_content"],
  },
  {
    group: "Identity",
    tags: ["authn", "authz", "session"],
  },
  {
    group: "Time",
    tags: ["scheduling", "time_display"],
  },
  {
    group: "I/O",
    tags: [
      "file_upload",
      "file_download",
      "external_api",
      "inbound_webhook",
      "outbound_message",
      "background_job",
      "realtime",
    ],
  },
  {
    group: "Data operations",
    tags: ["destructive_write", "bulk_write", "migration", "search"],
  },
  {
    group: "UI",
    tags: ["form_input", "route", "interactive_ui"],
  },
  {
    group: "Operations",
    tags: ["logging", "config_env", "caching", "rate_limited", "concurrent_edit"],
  },
] as const;

export const TOUCHES_TAGS = [
  "personal_data",
  "credentials",
  "money",
  "user_content",
  "authn",
  "authz",
  "session",
  "scheduling",
  "time_display",
  "file_upload",
  "file_download",
  "external_api",
  "inbound_webhook",
  "outbound_message",
  "background_job",
  "realtime",
  "destructive_write",
  "bulk_write",
  "migration",
  "search",
  "form_input",
  "route",
  "interactive_ui",
  "logging",
  "config_env",
  "caching",
  "rate_limited",
  "concurrent_edit",
] as const;

export type TouchesTag = (typeof TOUCHES_TAGS)[number];
export type TouchesTagGroupName = (typeof TOUCHES_TAG_GROUPS)[number]["group"];

export const TouchesTagSchema = z.enum(TOUCHES_TAGS);
export const isTouchesTag = isOneOf(TOUCHES_TAGS);
