import { validateEfSourceInWorkspace } from "./source-path.js";
import {
  EF_PICK_RESULT_TYPE,
  type EfPickResultMessage,
  type PickContextBundle,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isEfPickResultMessage(value: unknown): value is EfPickResultMessage {
  if (!isRecord(value)) return false;
  if (value.type !== EF_PICK_RESULT_TYPE) return false;
  return isRecord(value.pick);
}

export function validatePickResultMessage(
  raw: unknown,
  workspaceRoot: string,
): { ok: true; message: EfPickResultMessage } | { ok: false; reason: string } {
  if (!isEfPickResultMessage(raw)) {
    return { ok: false, reason: "invalid ef-pick-result envelope" };
  }
  const files = collectSourceFiles(raw.pick);
  for (const file of files) {
    const v = validateEfSourceInWorkspace(file, workspaceRoot);
    if (!v.ok) {
      return { ok: false, reason: v.reason ?? "invalid source path" };
    }
  }
  return { ok: true, message: raw };
}

function collectSourceFiles(pick: PickContextBundle): string[] {
  const out: string[] = [];
  if (pick.kind === "element") {
    if (pick.efSource) out.push(pick.efSource.file);
    for (const a of pick.ancestorSources) {
      out.push(a.file);
    }
  } else {
    for (const el of pick.intersectingElements) {
      if (el.efSource) out.push(el.efSource.file);
    }
  }
  return out;
}