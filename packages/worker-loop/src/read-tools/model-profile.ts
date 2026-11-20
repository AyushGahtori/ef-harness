/** Caps the read tools honor from the worker model profile (Task 053 / Task 054). */
export interface ReadModelProfile {
  readonly contextWindow: number;
}

export const SMALL_MODEL_CONTEXT_MAX = 32_768;
export const DEFAULT_READ_LINE_CAP = 400;
export const SMALL_READ_LINE_CAP = 200;
export const DEFAULT_TEST_FAILURE_CAP = 25;
export const SMALL_TEST_FAILURE_CAP = 10;
export const LONG_LINE_CHARS = 500;
export const GREP_MATCH_CAP = 50;
export const LIST_MATCH_CAP = 50;
export const GREP_LINE_CHARS = 200;
export const BUILD_ERROR_CAP = 30;
export const READ_LOG_MAX_LINES = 200;
export const READ_LOG_MAX_BYTES = 16 * 1024;
export const OUTLINE_ENTRY_CAP = 80;
export const KB_TEXT_CHARS = 4_000;

export interface ReadToolCaps {
  readonly readLines: number;
  readonly testFailures: number;
  readonly smallModel: boolean;
}

export function capsForProfile(profile: ReadModelProfile): ReadToolCaps {
  const smallModel = !Number.isFinite(profile.contextWindow) || profile.contextWindow <= SMALL_MODEL_CONTEXT_MAX;
  if (smallModel) {
    return {
      readLines: SMALL_READ_LINE_CAP,
      testFailures: SMALL_TEST_FAILURE_CAP,
      smallModel: true,
    };
  }
  return {
    readLines: DEFAULT_READ_LINE_CAP,
    testFailures: DEFAULT_TEST_FAILURE_CAP,
    smallModel: false,
  };
}
