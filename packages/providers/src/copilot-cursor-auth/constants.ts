export const DAY_MS = 24 * 60 * 60 * 1000;
export const CURSOR_KEY_LIFETIME_DAYS = 90;
export const CURSOR_KEY_LIFETIME_MS = CURSOR_KEY_LIFETIME_DAYS * DAY_MS;
export const CURSOR_REMINDER_WINDOW_MS = 7 * DAY_MS;
export const CURSOR_URGENT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DEVICE_FLOW_SLOW_DOWN_INCREMENT_MS = 5_000;
export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_DEVICE_VERIFICATION_URL = "https://github.com/login/device";
export const COPY_AND_OPEN_BUTTON_LABEL = "Copy code & Open github.com/login/device";
export const GENERATE_NEW_CODE_ACTION = "Generate new code";
export const CURSOR_RESIGN_IN_LABEL = "Re-sign in with Cursor";
export const CURSOR_REFRESH_NOW_LABEL = "Refresh now";

export const COPILOT_EXHAUSTED_ACTIONS = [
  "Switch to 0x included model",
  "Switch Connection",
  "Keep Parked",
] as const;

export function cliReuseLabel(login: string): string {
  return `Use your signed-in GitHub account (@${login})`;
}

export function exhaustedPremiumMessage(resetDateUtc: string): string {
  return `Copilot premium requests exhausted — resets on ${resetDateUtc} · Switch to 0x included model / Switch Connection / Keep Parked`;
}

export function cursorExpiryMessage(remainingMs: number): string {
  const days = Math.floor(remainingMs / DAY_MS);
  if (days <= 0) {
    return "Your Cursor key expires in less than 1 day — Refresh in 1 click";
  }
  const unit = days === 1 ? "day" : "days";
  return `Your Cursor key expires in ${days} ${unit} — Refresh in 1 click`;
}
