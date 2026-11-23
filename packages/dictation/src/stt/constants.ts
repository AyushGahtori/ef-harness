/** Confirmed only when the same token agrees across two consecutive frames. */
export const LOCAL_AGREEMENT_FRAMES = 2;

/** Low-confidence critical tokens are strictly below this probability. */
export const LOW_CONFIDENCE_P = 0.72;

export const HINT_AFTER_MS = 3_000;
export const MIC_OFF_AFTER_MS = 60_000;

/** RMS at or above this counts as speech and resets the silence clock. */
export const SPEECH_RMS = 0.02;

export const PCM_SAMPLE_RATE = 16_000;

/** Keep at most 60s of PCM in RAM. Older samples are zeroed, never flushed to disk. */
export const PCM_RETAIN_SAMPLES = PCM_SAMPLE_RATE * 60;

export const PAUSED_LISTENING_HINT =
  "Paused listening… press Enter to send or keep talking";

export const MIC_OFF_AFTER_SILENCE =
  "Mic turned off after 60s silence — draft kept safely";

export const MIC_DISCONNECTED = "Microphone disconnected — check Windows mic settings";

export const OS_DICTATION_BADGE =
  "Using Windows Dictation · Download local Whisper for offline accuracy";

export const DOWNLOAD_LOCAL_WHISPER = "Download local Whisper (offline, higher accuracy)";

export const VERIFY_OR_EDIT = "Verify or edit";

export const DEFAULT_HOTKEY_LABEL = "Ctrl+Space";

export const NEGATIONS = new Set([
  "don't",
  "dont",
  "doesn't",
  "doesnt",
  "didn't",
  "didnt",
  "can't",
  "cant",
  "won't",
  "wont",
  "isn't",
  "isnt",
  "aren't",
  "arent",
  "wasn't",
  "wasnt",
  "weren't",
  "werent",
  "never",
  "no",
  "without",
  "not",
  "cannot",
]);

export const QUANTIFIERS = new Set(["only", "all", "except"]);

export const UNITS = new Set([
  "kb",
  "mb",
  "gb",
  "tb",
  "pb",
  "ms",
  "s",
  "sec",
  "secs",
  "second",
  "seconds",
  "px",
  "%",
  "percent",
  "mbps",
  "gbps",
]);

export const WEEKDAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const MONTHS = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

/** Ordinary words that must never take an amber underline. */
export const FILLER = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "is",
  "it",
  "that",
  "this",
  "with",
  "as",
  "be",
  "by",
  "from",
  "your",
  "you",
  "we",
  "they",
  "i",
  "um",
  "uh",
  "so",
  "just",
  "like",
  "please",
  "make",
  "sure",
  "orders",
  "allow",
  "edits",
  "after",
  "should",
  "use",
  "can",
  "will",
  "would",
  "have",
  "has",
  "had",
  "are",
  "was",
  "were",
  "been",
  "being",
  "do",
  "does",
  "did",
  "if",
  "then",
  "than",
  "into",
  "about",
  "keep",
  "let",
  "its",
  "our",
  "my",
  "me",
  "them",
  "their",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "there",
  "here",
]);
