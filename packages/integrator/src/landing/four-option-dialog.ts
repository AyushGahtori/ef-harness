import type { FourOptionId, FourOptionPresentation } from "./types.js";

export const DIRTY_OVERLAP_FOUR_OPTIONS: readonly {
  readonly id: FourOptionId;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: "commit_first_then_land",
    label: "Commit your edits first, then land",
    description:
      "Guides a clean commit of your work, runs base sync + conflict check, then lands onto your branch.",
  },
  {
    id: "land_separate_branch",
    label: "Land onto a separate new branch",
    description:
      "Creates ef/<feature-slug> at harness/integration HEAD, leaving your dirty working directory untouched.",
  },
  {
    id: "side_by_side_diff",
    label: "Open side-by-side diff for overlapping files",
    description: "Inspect overlapping hunks (Your local edit vs Harness build) before landing.",
  },
  {
    id: "cancel",
    label: "Cancel landing — keep on harness/integration",
    description: "Zero changes made anywhere in your checkout or branch refs.",
  },
] as const;

export class DirtyOverlapFourOptionDialog {
  buildPresentation(overlappingPaths: readonly string[]): FourOptionPresentation {
    return {
      title: "Landing waits — overlapping uncommitted edits",
      overlappingPaths: [...overlappingPaths],
      options: DIRTY_OVERLAP_FOUR_OPTIONS,
    };
  }

  resolveChoice(
    choice: FourOptionId,
    input: {
      readonly repoPath: string;
      readonly featureSlug: string;
      readonly harnessIntegrationRef: string;
    },
  ): { readonly action: "halt" | "create_branch" | "cancel"; readonly branchName?: string } {
    switch (choice) {
      case "commit_first_then_land":
      case "side_by_side_diff":
        return { action: "halt" };
      case "land_separate_branch":
        return {
          action: "create_branch",
          branchName: `ef/${input.featureSlug}`,
        };
      case "cancel":
      default:
        return { action: "cancel" };
    }
  }
}