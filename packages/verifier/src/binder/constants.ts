/** Thrown by generated contract stubs and recognized by the red-before-green gate. */
export const EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED =
  "EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED";

/** Binder adapters live here and nowhere under product source. */
export const HARNESS_BINDER_DIR = ".harness-binder";

export const FORBIDDEN_INPUT_FIELDS = [
  "expect",
  "expected",
  "expectedOutput",
  "rubric",
  "oracle",
] as const;

export type ForbiddenInputField = (typeof FORBIDDEN_INPUT_FIELDS)[number];
