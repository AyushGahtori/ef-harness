import fs from "node:fs";
import path from "node:path";

export interface DiscoveryDraft {
  readonly workItemId: string;
  readonly target: string | null;
  readonly text: string;
  readonly updatedAt: number;
}

/** Local draft storage. Autosave writes only here and never opens a turn. */
export interface DraftStore {
  save(draft: DiscoveryDraft): void;
  load(workItemId: string): DiscoveryDraft | null;
  clear(workItemId: string): void;
}

export class MemoryDraftStore implements DraftStore {
  private readonly drafts = new Map<string, DiscoveryDraft>();

  save(draft: DiscoveryDraft): void {
    this.drafts.set(draft.workItemId, { ...draft });
  }

  load(workItemId: string): DiscoveryDraft | null {
    const draft = this.drafts.get(workItemId);
    return draft ? { ...draft } : null;
  }

  clear(workItemId: string): void {
    this.drafts.delete(workItemId);
  }
}

export class FileDraftStore implements DraftStore {
  constructor(private readonly directory: string) {}

  save(draft: DiscoveryDraft): void {
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(this.pathFor(draft.workItemId), JSON.stringify(draft), "utf8");
  }

  load(workItemId: string): DiscoveryDraft | null {
    const file = this.pathFor(workItemId);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as DiscoveryDraft;
    return parsed;
  }

  clear(workItemId: string): void {
    const file = this.pathFor(workItemId);
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  private pathFor(workItemId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(workItemId)) {
      throw new Error(`draft work item id ${workItemId} is not a safe file name`);
    }
    return path.join(this.directory, `${workItemId}.json`);
  }
}
