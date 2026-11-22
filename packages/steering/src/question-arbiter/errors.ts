export class QuestionArbiterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidQuestionError extends QuestionArbiterError {
  constructor(message: string) {
    super("INVALID_QUESTION", message);
  }
}

export class QuestionNotFoundError extends QuestionArbiterError {
  constructor(questionId: string) {
    super("QUESTION_NOT_FOUND", `Question ${questionId} does not exist.`);
  }
}

export class HoldClearFailedError extends QuestionArbiterError {
  constructor() {
    super("HOLD_CLEAR_FAILED", "Hold clear failed; the answer transaction rolled back.");
  }
}

export class QuestionTransactionError extends QuestionArbiterError {
  constructor(message: string) {
    super("QUESTION_TRANSACTION_FAILED", message);
  }
}
