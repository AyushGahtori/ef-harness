/** Pinned resume-changer benchmark and M5 limits. Local ports keep the sibling names. */

export const PINNED_COMMIT = "497831ec5aa7effb354bb1a8d22d2f031b17a4e0";
export const DOC_COUNT = 73;
export const PLAN_FILE_COUNT = 17;
export const PLAN_LINE_COUNT = 4906;
export const REPORT_SCHEMA = "m5-exit-gate-report@1";
export const BENCHMARK_FILE = "resume-changer-benchmark.json";
export const CODE_INDEX_DB = "code-index.db";

export const L0_BUDGET_MS = 2_000;
export const IMPACT_BUDGET_MS = 15;
export const MAX_FOCUS_FILES = 20;
export const MAX_VISUAL_LAG_MS = 2_000;
export const UNBOUNDED_LAG_MS = 2_300;
export const IDLE_CPU_CEILING = 5;
export const HOST_BUDGET_MS = 120_000;
export const HELPER_VISIBLE_CAP = 3;
export const BULLPEN_VISIBLE_DESK_CAP = 28;
export const HOT_DESK_POPULATION = 32;
export const AGENT_TAG_MAX_CHARS = 22;
export const LOW_CONFIDENCE = 0.72;
export const DICTATION_HINT_MS = 3_000;
export const DICTATION_PAUSE_CHECK_MS = 4_000;
export const DICTATION_MIC_OFF_MS = 60_000;
export const BURST_WINDOW_MS = 400;
export const MAX_QUEUE_LEN = 2;
export const PAGE_RANK_DAMPING = 0.85;
export const PAGE_RANK_ITERS = 20;
export const PREVIEW_PARTITION = "persist:ef-preview-resume-changer";
export const APP_PARTITION = "persist:ef-app";
export const EF_SOURCE_ATTR = "data-ef-source";
export const HARNESS_EMAIL = "foundation@ef-harness.local";
export const PRINT_TITLE = "Implement a printable meal summary page";
export const EXPECTED_OFFICE_TAG = "A0014 \u00b7 print page";
export const STALE_STATUS = "likely_stale";
export const DICTATION_HINT =
  "Paused listening\u2026 press Enter to send or keep talking";
export const DICTATION_MIC_OFF = "Mic turned off after 60s silence \u2014 draft kept safely";
export const ORANGE_FALLBACK_BANNER =
  "Switched to Board view to keep your laptop responsive (RAM pressure) \u00b7 Switch back to Office when ready";
export const VOCAB_TOOLTIP = "Auto-corrected from 'supabase' \u00b7 Undo";
export const SPOKEN_RULE = "change rule seventeen";
export const SPOKEN_THERE = "there are seventeen menus";
export const SPOKEN_MISSING = "rule ninety nine";
export const SPOKEN_RULE_NORMALIZED = "change R17";

export const ROOM_IDS = [
  "ceo-office",
  "front-desk",
  "discovery-lounge",
  "research-library",
  "architecture-studio",
  "planning-war-room",
  "engineering-bullpen",
  "qa-verification-lab",
  "integration-merge-bay",
  "shipping-dock",
  "break-room",
] as const;

export type OfficeRoomId = (typeof ROOM_IDS)[number];

export const COMPETING_UI_KITS = ["@mui/material", "@chakra-ui/react", "antd"] as const;

export const VERIFIED_IDS = ["R17", "T-42", "A0014", "REQ-3"] as const;

export const ZOOM_SAMPLES = [
  { zoom: 0.3, level: "L1" },
  { zoom: 0.6, level: "L2" },
  { zoom: 1, level: "L3" },
  { zoom: 1.5, level: "L4" },
] as const;

export const UI_WIDTHS = [375, 768, 1440] as const;
