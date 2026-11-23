import { caretFrom } from "./target.js";
import type { DraftCaret, StoredDraft } from "./types.js";
import { EMPTY_CARET } from "./types.js";

export interface KeyValueSession {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DRAFT_SESSION_KEY = "ef-harness.composer.per-target-drafts";

export class MemorySessionStorage implements KeyValueSession {
  private readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

export function resolveSessionStorage(injected?: KeyValueSession): KeyValueSession {
  if (injected) return injected;
  const host = globalThis as { sessionStorage?: KeyValueSession };
  const candidate = host.sessionStorage;
  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  ) {
    return candidate;
  }
  return new MemorySessionStorage();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PerTargetDraftStore {
  private readonly memory = new Map<string, StoredDraft>();
  private readonly session: KeyValueSession;
  private readonly now: () => string;

  constructor(options?: { readonly session?: KeyValueSession; readonly now?: () => string }) {
    this.session = resolveSessionStorage(options?.session);
    this.now = options?.now ?? (() => new Date().toISOString());
    this.hydrate();
  }

  save(targetKey: string, caret: DraftCaret): StoredDraft {
    const record: StoredDraft = {
      targetKey,
      text: caret.text,
      cursor: caretFrom(caret.text, caret.cursor, caret.selectionEnd).cursor,
      selectionEnd: caretFrom(caret.text, caret.cursor, caret.selectionEnd).selectionEnd,
      savedAt: this.now(),
    };
    this.memory.set(targetKey, record);
    this.flush();
    return record;
  }

  read(targetKey: string): DraftCaret {
    const found = this.memory.get(targetKey);
    if (!found) return { ...EMPTY_CARET };
    return caretFrom(found.text, found.cursor, found.selectionEnd);
  }

  has(targetKey: string): boolean {
    const found = this.memory.get(targetKey);
    return found !== undefined && found.text.length > 0;
  }

  keys(): readonly string[] {
    return [...this.memory.keys()];
  }

  private hydrate(): void {
    const raw = this.session.getItem(DRAFT_SESSION_KEY);
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed) || !isRecord(parsed.drafts)) return;
    for (const [key, value] of Object.entries(parsed.drafts)) {
      if (!isRecord(value) || typeof value.text !== "string") continue;
      const cursor = typeof value.cursor === "number" ? value.cursor : value.text.length;
      const selectionEnd = typeof value.selectionEnd === "number" ? value.selectionEnd : cursor;
      const savedAt = typeof value.savedAt === "string" ? value.savedAt : this.now();
      const caret = caretFrom(value.text, cursor, selectionEnd);
      this.memory.set(key, { targetKey: key, ...caret, savedAt });
    }
  }

  private flush(): void {
    const drafts: Record<string, StoredDraft> = {};
    for (const [key, value] of this.memory) {
      drafts[key] = value;
    }
    this.session.setItem(DRAFT_SESSION_KEY, JSON.stringify({ drafts }));
  }
}
