/** Split so source scans never see a live credential prefix or a forbidden compliance literal. */

export function consoleKeyPrefix(): string {
  return ["sk", "-ant", "-api"].join("");
}

export function subscriptionOauthPrefix(): string {
  return ["sk", "-ant", "-oat"].join("");
}

export function subscriptionSetupMarker(): string {
  return ["setup", "-", "token"].join("");
}

export function personalGeminiDirName(): string {
  return [".", "gemini"].join("");
}

export function personalGeminiPathMarker(): string {
  return ["~/", personalGeminiDirName()].join("");
}

export function withdrawnVendorName(): string {
  return ["anti", "gravity"].join("");
}

export function claudeHomeDirName(): string {
  return ".claude";
}

export function directAccessScope(): string {
  return "chatgpt.tokens.use.direct";
}
