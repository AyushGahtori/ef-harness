import { createHash } from "node:crypto";
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
    const hash = createHash("sha256").update(content).digest("hex");
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
