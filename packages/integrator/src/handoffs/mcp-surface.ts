import { READ_RESULT_TOOL } from "./constants.js";
import { FreeFormChatRejectedError } from "./errors.js";
import { ReadResultToolHandler } from "./read-result.js";
import type { ReadResult, ReadResultCaller } from "./types.js";

export class HandoffMcpSurface {
  readonly toolNames = [READ_RESULT_TOOL] as const;

  constructor(private readonly reader: ReadResultToolHandler) {}

  dispatch(tool: string, caller: ReadResultCaller, args: Readonly<Record<string, unknown>>): ReadResult {
    if (tool !== READ_RESULT_TOOL) throw new FreeFormChatRejectedError();
    return this.reader.read(caller, args);
  }
}
