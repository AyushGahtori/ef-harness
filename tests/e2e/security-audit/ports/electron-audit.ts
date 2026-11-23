/** Static Electron hardening expectations for Tasks 122–123 preview surfaces. */

export interface WindowSecurityProfile {
  readonly label: string;
  readonly nodeIntegration: boolean;
  readonly contextIsolation: boolean;
  readonly sandbox: boolean;
  readonly csp: string;
  readonly partition?: string;
  readonly preloadApis: number;
}

const STRICT_CSP = "default-src 'self'";

export function expectedProfiles(): readonly WindowSecurityProfile[] {
  return [
    {
      label: "main",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      csp: STRICT_CSP,
      preloadApis: 0,
    },
    {
      label: "pop-out",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      csp: STRICT_CSP,
      preloadApis: 0,
    },
    {
      label: "preview-webview",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      csp: STRICT_CSP,
      partition: "persist:ef-preview-audit",
      preloadApis: 0,
    },
  ];
}

export function auditElectronProfiles(faults?: { weakCsp?: boolean; privilegedPreload?: boolean }): {
  readonly profiles: readonly WindowSecurityProfile[];
  readonly ok: boolean;
} {
  const profiles = expectedProfiles().map((row) => {
    if (row.label === "preview-webview" && faults?.privilegedPreload) {
      return { ...row, preloadApis: 1 };
    }
    if (faults?.weakCsp) {
      return { ...row, csp: "default-src *" };
    }
    return row;
  });
  const ok = profiles.every(
    (row) =>
      !row.nodeIntegration &&
      row.contextIsolation &&
      row.sandbox &&
      row.csp === STRICT_CSP &&
      row.preloadApis === 0,
  );
  return { profiles, ok };
}