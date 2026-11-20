export const M1_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const ELECTRON_SECURITY_DEFAULTS = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const;

export const PRELOAD_EXPOSES = ["ef-port"] as const;
