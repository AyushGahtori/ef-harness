export const HUMAN_OWNED = "HUMAN_OWNED" as const;
export const CODING = "CODING" as const;
export const STATIC_AUDIT = "STATIC_AUDIT" as const;
export const CLEAN_VERIFY = "CLEAN_VERIFY" as const;
export const ACCEPTED = "ACCEPTED" as const;

export const HUMAN_FIX_TRAILER_AUTHOR_MODE = "EF-Author-Mode";
export const HUMAN_FIX_TRAILER_TASK = "EF-Task";
export const HUMAN_AUTHOR_MODE_VALUE = "human-fixed";

export const HUMAN_ENTRY_CARD = "card_inspector";
export const HUMAN_ENTRY_CHAT = "chat_steering";
export const HUMAN_ENTRY_COMMIT = "commit_detection";

export const WORKSPACE_TASK_WORKTREE = "task_worktree_vscode";
export const WORKSPACE_MAIN_CHECKOUT = "main_checkout";

export const OVERRIDE_FIX_CODE = "fix_code";
export const OVERRIDE_TEST_WRONG = "this_test_is_wrong";
export const OVERRIDE_ACCEPT_ANYWAY = "accept_anyway";

export const VERIFICATION_HUMAN_OVERRIDE = "human_override_accepted";

export const HAND_BACK_TO_AI = "hand_back_to_ai";

export const TASK_BRANCH_PREFIX = "harness/t/";
export const CHECKPOINT_PREFIX = "refs/harness/checkpoints/";

/** Legal predecessors for entering HUMAN_OWNED (Task 021 parity). */
export const HUMAN_OWNED_ENTRY_STATES = [
  "CODING",
  "WAITING_INPUT",
  "PARKED",
  "ESCALATED",
  "EXHAUSTED",
] as const;