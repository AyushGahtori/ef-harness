export type CrewLevelsErrorCode =
  | "bad-probability"
  | "negative-money"
  | "bad-task"
  | "bad-model"
  | "unsigned-policy"
  | "currency-mix"
  | "no-eligible-model";

export class CrewLevelsError extends Error {
  readonly code: CrewLevelsErrorCode;

  constructor(code: CrewLevelsErrorCode, message: string) {
    super(message);
    this.name = "CrewLevelsError";
    this.code = code;
  }
}
