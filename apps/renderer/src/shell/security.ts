export const ELECTRON_RENDERER_SECURITY = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  rawIpcRenderer: false,
  contentSecurityPolicy: "default-src 'self'",
  externalCdnFonts: false,
  externalCdnScripts: false,
  unsafeEval: false,
} as const;

export function securityPolicyFindings(): readonly string[] {
  const findings: string[] = [];
  if (ELECTRON_RENDERER_SECURITY.nodeIntegration !== false) findings.push("nodeIntegration enabled");
  if (ELECTRON_RENDERER_SECURITY.contextIsolation !== true) findings.push("contextIsolation disabled");
  if (ELECTRON_RENDERER_SECURITY.sandbox !== true) findings.push("sandbox disabled");
  if (ELECTRON_RENDERER_SECURITY.rawIpcRenderer !== false) findings.push("raw ipc bridge enabled");
  if (!ELECTRON_RENDERER_SECURITY.contentSecurityPolicy.includes("default-src 'self'")) {
    findings.push("content security policy is not default-src 'self'");
  }
  if (ELECTRON_RENDERER_SECURITY.externalCdnFonts || ELECTRON_RENDERER_SECURITY.externalCdnScripts) {
    findings.push("external CDN asset");
  }
  if (ELECTRON_RENDERER_SECURITY.unsafeEval) findings.push("unsafe eval enabled");
  return findings;
}

export function sourceSecurityFindings(source: string): readonly string[] {
  const findings: string[] = [];
  const rawIpc = ["ipc", "Renderer"].join("");
  if (source.includes(rawIpc)) findings.push("raw ipc renderer reference");
  const nodeFlag = ["node", "Integration"].join("");
  if (new RegExp(`${nodeFlag}\\s*[:=]\\s*true`).test(source)) findings.push("node integration enabled");
  const filesystem = ["node:", "fs"].join("");
  if (source.includes(filesystem)) findings.push("direct filesystem import");
  const htmlSink = ["dangerously", "SetInnerHTML"].join("");
  if (source.includes(htmlSink)) findings.push("unescaped html sink");
  const inner = ["inner", "HTML"].join("");
  if (source.includes(inner)) findings.push("inner html write");
  if (/\beval\s*\(/.test(source) || source.includes(["new ", "Function"].join(""))) {
    findings.push("dynamic code execution");
  }
  if (/https?:\/\//.test(source)) findings.push("external url");
  return findings;
}
