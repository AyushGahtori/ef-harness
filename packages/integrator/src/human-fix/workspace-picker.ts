import { WORKSPACE_MAIN_CHECKOUT, WORKSPACE_TASK_WORKTREE } from "./constants.js";
import type { WorktreeSlotPoolPort } from "./ports.js";
import type { WorkspaceChoice, WorkspacePickerResult } from "./types.js";

export class HumanEditWorkspacePicker {
  constructor(
    private readonly slots: WorktreeSlotPoolPort,
    private readonly mainCheckoutPath: string,
  ) {}

  present(taskId: string): WorkspacePickerResult {
    const slot = this.slots.resolveTaskWorktree(taskId);
    const worktreeOption: WorkspacePickerResult["options"][number] = {
      id: WORKSPACE_TASK_WORKTREE,
      label: "Open task worktree in VS Code",
      recommended: true,
      ...(slot.path ? { vscodeCommand: `code ${slot.path}` } : {}),
    };
    const options: WorkspacePickerResult["options"] = [
      worktreeOption,
      {
        id: WORKSPACE_MAIN_CHECKOUT,
        label: "Edit in my main checkout / Use my existing commit",
        recommended: false,
      },
    ];
    return {
      taskId,
      choice: WORKSPACE_TASK_WORKTREE,
      ...(slot.path ? { worktreePath: slot.path } : {}),
      options,
    };
  }

  choose(taskId: string, choice: WorkspaceChoice): WorkspacePickerResult {
    const presented = this.present(taskId);
    if (choice === WORKSPACE_MAIN_CHECKOUT) {
      return { ...presented, choice, worktreePath: this.mainCheckoutPath };
    }
    return { ...presented, choice };
  }
}