import { stringField } from "./normalize.js";
import type {
  EditToolDispatcherPort,
  HarnessRunPort,
  KnowledgeToolPort,
  NotesUpdatePort,
  ReadLogPort,
  WindowedFileReaderPort,
} from "./ports.js";
import { toolBody, type ToolBody, type ToolCall, type WorkingMemory } from "./types.js";

export interface DispatchSurface {
  reader: WindowedFileReaderPort;
  edits: EditToolDispatcherPort;
  runner: HarnessRunPort;
  readLog: ReadLogPort;
  kb: KnowledgeToolPort;
  notes: NotesUpdatePort;
  memory: WorkingMemory;
}

export async function dispatchTool(
  surface: DispatchSurface,
  call: ToolCall,
): Promise<ToolBody> {
  const args = call.arguments;
  if (call.name === "read_file") {
    const path = stringField(args, "path") ?? "";
    const start = numberField(args, "start");
    const end = numberField(args, "end");
    const range = start === null || end === null ? null : { start, end };
    return surface.reader.readFile(path, range);
  }
  if (call.name === "list") {
    return surface.reader.listFiles(stringField(args, "glob") ?? "**/*");
  }
  if (call.name === "grep") {
    return surface.reader.grepFiles(stringField(args, "pattern") ?? "", stringField(args, "glob"));
  }
  if (
    call.name === "apply_patch" ||
    call.name === "str_replace" ||
    call.name === "search_replace" ||
    call.name === "write_new_file" ||
    call.name === "replace_lines"
  ) {
    const written = await applyEdit(surface.edits, call);
    return toolBody({
      ok: true,
      summary: `edit ${written.filesWritten.join(",")}`,
      output: written.filesWritten.join("\n"),
      changedFiles: written.filesWritten,
    });
  }
  if (call.name === "harness.run") {
    return surface.runner.run(stringField(args, "command") ?? "");
  }
  if (call.name === "harness.read_log") {
    return surface.readLog.readLog(stringField(args, "artifactId") ?? "", stringField(args, "query"));
  }
  if (call.name.startsWith("kb.")) {
    return surface.kb.call(call.name, args);
  }
  if (call.name === "notes.update") {
    const memory = surface.notes.apply(surface.memory, args);
    return toolBody({
      ok: true,
      summary: "notes.update",
      output: "working memory updated",
      memory,
    });
  }
  return toolBody({
    ok: false,
    summary: `malformed: no dispatcher for ${call.name}`,
    output: `no dispatcher for ${call.name}`,
  });
}

async function applyEdit(
  edits: EditToolDispatcherPort,
  call: ToolCall,
): Promise<{ filesWritten: string[] }> {
  const args = call.arguments;
  const path = stringField(args, "path") ?? stringField(args, "file") ?? "";
  const content = stringField(args, "content") ?? stringField(args, "new_text") ?? stringField(args, "newText") ?? "";
  const oldText = stringField(args, "old_text") ?? stringField(args, "oldText") ?? "";
  if (call.name === "apply_patch") {
    return edits.applyPatch(stringField(args, "patch") ?? stringField(args, "text") ?? content);
  }
  if (call.name === "str_replace") return edits.strReplace(path, oldText, content);
  if (call.name === "search_replace") {
    return edits.searchReplace(stringField(args, "blocks") ?? content);
  }
  if (call.name === "write_new_file") return edits.writeNewFile(path, content);
  const start = numberField(args, "start") ?? 1;
  const end = numberField(args, "end") ?? start;
  const rangeHash = stringField(args, "range_hash") ?? stringField(args, "rangeHash") ?? "";
  return edits.replaceLines(path, start, end, content, rangeHash);
}

function numberField(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === "number" ? value : null;
}
