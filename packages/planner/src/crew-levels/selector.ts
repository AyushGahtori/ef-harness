import type { HistoricalPassRateCalibrator } from "./calibrator.js";
import { TaskDifficultyClassifier } from "./difficulty.js";
import type { VersionedModelRoster } from "./roster.js";
import {
  type LevelSelectionInput,
  type SelectionOptions,
  selectLevelAssignment,
  selectionInput,
} from "./selection-core.js";
import type { LevelAssignment } from "./types.js";

export { selectionInput };
export type { LevelSelectionInput, SelectionOptions };

export class ExpectedCostLevelSelector {
  constructor(
    private readonly roster: VersionedModelRoster,
    private readonly calibrator: HistoricalPassRateCalibrator,
    private readonly classifier: TaskDifficultyClassifier = new TaskDifficultyClassifier(),
  ) {}

  select(input: LevelSelectionInput): LevelAssignment {
    return selectLevelAssignment(this.roster, this.calibrator, this.classifier, input);
  }
}
