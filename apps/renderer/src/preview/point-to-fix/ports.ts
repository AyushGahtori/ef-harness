import type { LayoutBox, SourceLocation, ThemeName } from "./types.js";

export interface CasPutPin {
  readonly holderKind: string;
  readonly holderId: string;
  readonly mediaType: string;
}

export interface CasBlobStorePort {
  putBlob(content: Uint8Array, pin: CasPutPin): { readonly hash: string };
  getBlob(hash: string): Uint8Array | null;
}

export class MemoryCasBlobStore implements CasBlobStorePort {
  readonly blobs = new Map<string, Uint8Array>();

  putBlob(content: Uint8Array, pin: CasPutPin): { readonly hash: string } {
    void pin;
    const hash = sha256Hex(content);
    this.blobs.set(hash, new Uint8Array(content));
    return { hash };
  }

  getBlob(hash: string): Uint8Array | null {
    return this.blobs.get(hash) ?? null;
  }
}

export interface ScreenshotPort {
  capture(rect: LayoutBox): Uint8Array;
}

export interface CodeIndexQuery {
  readonly role: string | null;
  readonly name: string | null;
  readonly route: string;
}

export interface CodeIndexLookupPort {
  lookup(query: CodeIndexQuery): SourceLocation | null;
}

export class MemoryCodeIndex implements CodeIndexLookupPort {
  constructor(
    private readonly rows: readonly {
      readonly role: string;
      readonly name: string;
      readonly route: string;
      readonly file: string;
      readonly line: number;
      readonly column: number;
    }[],
  ) {}

  lookup(query: CodeIndexQuery): SourceLocation | null {
    const row = this.rows.find(
      (item) => item.role === query.role && item.name === query.name && item.route === query.route,
    );
    if (!row) return null;
    return {
      file: row.file,
      line: row.line,
      column: row.column,
      raw: `${row.file}:${row.line}:${row.column}`,
    };
  }
}

export interface PreviewElementBinding {
  readonly elementId: string;
  readonly label: string;
  readonly source: string;
  readonly thumbnailPng: Uint8Array;
}

export interface SingleComposerViewPort {
  inspectPreviewElement(element: PreviewElementBinding): void;
  activateTarget(target: { readonly kind: "Element"; readonly element: PreviewElementBinding }): void;
  changeCount(): number;
}

export class LocalSingleComposer implements SingleComposerViewPort {
  pill = "Message project / steering";
  thumbnail: Uint8Array | null = null;
  lastElement: PreviewElementBinding | null = null;
  private changes = 0;

  inspectPreviewElement(element: PreviewElementBinding): void {
    this.changes += 1;
    this.lastElement = element;
    this.thumbnail = new Uint8Array(element.thumbnailPng);
    this.pill = `Fixing UI: ${element.label} (${element.source}) · ✕`;
  }

  activateTarget(target: { readonly kind: "Element"; readonly element: PreviewElementBinding }): void {
    this.inspectPreviewElement(target.element);
  }

  changeCount(): number {
    return this.changes;
  }
}

export interface IsolatedPreviewWebviewHostPort {
  readonly origin: string;
  executeJavaScript(script: string): void;
}

export interface ViewportCheck {
  readonly width: number;
  readonly passed: boolean;
  readonly regressions: number;
}

export interface UiPlaywrightContractVerifierPort {
  verifyViewports(input: {
    readonly route: string;
    readonly viewports: readonly number[];
  }): readonly ViewportCheck[];
}

export interface AxeAuditPort {
  audit(route: string): { readonly serious: number };
}

export interface DesignTokenLintPort {
  lint(files: readonly string[]): { readonly passed: boolean; readonly errors: readonly string[] };
}

export class PassingUiPlaywrightVerifier implements UiPlaywrightContractVerifierPort {
  verifyViewports(input: {
    readonly route: string;
    readonly viewports: readonly number[];
  }): readonly ViewportCheck[] {
    return input.viewports.map((width) => ({ width, passed: true, regressions: 0 }));
  }
}

export class PassingAxeAudit implements AxeAuditPort {
  audit(route: string): { readonly serious: number } {
    void route;
    return { serious: 0 };
  }
}

export class PassingTokenLint implements DesignTokenLintPort {
  lint(files: readonly string[]): { readonly passed: boolean; readonly errors: readonly string[] } {
    void files;
    return { passed: true, errors: [] };
  }
}

export interface VisualBaselinePort {
  commitAtomic(entries: readonly { readonly key: string; readonly png: Uint8Array }[]): {
    readonly baselineIds: readonly string[];
  };
  has(key: string): boolean;
  read(key: string): Uint8Array | null;
}

export class MemoryVisualBaselineStore implements VisualBaselinePort {
  private records = new Map<string, Uint8Array>();

  commitAtomic(entries: readonly { readonly key: string; readonly png: Uint8Array }[]): {
    readonly baselineIds: readonly string[];
  } {
    const next = new Map(this.records);
    const baselineIds: string[] = [];
    for (const entry of entries) {
      if (!isPngSignature(entry.png)) throw new Error("baseline png is invalid");
      next.set(entry.key, new Uint8Array(entry.png));
      baselineIds.push(`toHaveScreenshot:${entry.key}`);
    }
    this.records = next;
    return { baselineIds };
  }

  has(key: string): boolean {
    return this.records.has(key);
  }

  read(key: string): Uint8Array | null {
    return this.records.get(key) ?? null;
  }
}

function isPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

export interface FixWorkspacePort {
  snapshot(files: readonly string[]): string;
  restore(snapshotId: string): { readonly restored: readonly string[] };
  read(file: string): string | null;
  write(file: string, content: string): void;
}

export class MemoryFixWorkspace implements FixWorkspacePort {
  private files = new Map<string, string>();
  private snapshots = new Map<string, Map<string, string>>();
  private sequence = 0;

  write(file: string, content: string): void {
    this.files.set(file, content);
  }

  read(file: string): string | null {
    return this.files.get(file) ?? null;
  }

  snapshot(files: readonly string[]): string {
    this.sequence += 1;
    const id = `snap-${this.sequence}`;
    const copy = new Map<string, string>();
    for (const file of files) copy.set(file, this.files.get(file) ?? "");
    this.snapshots.set(id, copy);
    return id;
  }

  restore(snapshotId: string): { readonly restored: readonly string[] } {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) throw new Error("fix snapshot is missing");
    const restored: string[] = [];
    for (const [file, content] of snap) {
      this.files.set(file, content);
      restored.push(file);
    }
    return { restored };
  }
}

export interface PageContext {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly route: string;
  readonly theme: ThemeName;
  readonly scrollY: number;
}

function sha256Hex(content: Uint8Array): string {
  const words = new Uint32Array(64);
  const hash = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const k = Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bitLength = content.length * 8;
  const withPad = new Uint8Array(((content.length + 9 + 63) & ~63));
  withPad.set(content);
  withPad[content.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLength >>> 0);
  view.setUint32(withPad.length - 8, Math.floor(bitLength / 0x100000000));
  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15] ?? 0;
      const w2 = words[index - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      words[index] = (((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0);
    }
    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (k[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
