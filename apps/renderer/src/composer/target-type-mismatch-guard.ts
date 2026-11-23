import { sideLabel } from "./target.js";
import type {
  ComposerTarget,
  MismatchPrompt,
  QuestionOption,
  QuestionTarget,
} from "./types.js";

const UI_TOPIC =
  /\b(header|background|darker|blue|button|color|colour|font|padding|margin|logo|icon|border|shadow|spacing|pixel|layout|sidebar|footer|navbar|css)\b/i;

const IMPERATIVE =
  /\b(make|change|move|send|add|show|fix|update|darken|lighten|resize)\b/i;

interface PositionalHit {
  readonly position: number;
  readonly echo: string;
}

export class TargetTypeMismatchGuard {
  inspect(input: {
    readonly target: ComposerTarget;
    readonly text: string;
    readonly openQuestion: QuestionTarget | null;
  }): MismatchPrompt | null {
    const text = input.text.trim();
    const question = input.openQuestion;
    if (!text || !question || question.options.length < 2) return null;

    if (input.target.kind !== "Question") {
      const positional = parsePositional(text, question);
      if (positional) {
        return {
          kind: "positional-non-question",
          message: `Did you mean Option ${positional.echo} for '${question.title}'?`,
          question,
          optionPosition: positional.position,
          actions: [
            { id: "answer-question", label: `Yes, answer '${question.title}'` },
            { id: "keep-current", label: `No, keep it on ${sideLabel(input.target)}` },
          ],
        };
      }
      const labelHit = matchingOptionLabel(text, question);
      if (labelHit) {
        return {
          kind: "option-label",
          message: `Did you mean this as the answer to ${question.questionId} (${question.title})?`,
          question,
          optionPosition: labelHit.position,
          actions: [
            { id: "answer-question", label: `Yes, answer ${question.questionId}` },
            { id: "keep-current", label: `No, keep it on ${sideLabel(input.target)}` },
          ],
        };
      }
      return null;
    }

    if (looksUnrelatedToOptions(text, question)) {
      return {
        kind: "unrelated-topic",
        message: `Send as answer to ${question.title}, or switch to General steering?`,
        question,
        optionPosition: null,
        actions: [
          { id: "send-as-answer", label: `Send as answer to ${question.title}` },
          { id: "switch-to-general", label: "Switch to General steering" },
        ],
      };
    }
    return null;
  }
}

function parsePositional(text: string, question: QuestionTarget): PositionalHit | null {
  const numeric = /^(?:option\s+)?([1-9])$/i.exec(text);
  const numericToken = numeric?.[1];
  if (numericToken) {
    return { position: Number(numericToken), echo: numericToken };
  }
  const letter = /^(?:option\s+)?([A-Z])$/i.exec(text);
  const letterToken = letter?.[1];
  if (!letterToken) return null;
  const upper = letterToken.toUpperCase();
  const position = upper.charCodeAt(0) - 64;
  if (position < 1 || position > question.options.length) return null;
  return { position, echo: upper };
}

function matchingOptionLabel(text: string, question: QuestionTarget): QuestionOption | null {
  const folded = text.toLowerCase();
  return question.options.find((option) => option.label.toLowerCase() === folded) ?? null;
}

function looksUnrelatedToOptions(text: string, question: QuestionTarget): boolean {
  if (parsePositional(text, question)) return false;
  if (matchingOptionLabel(text, question)) return false;
  if (overlapsOption(text, question)) return false;
  return UI_TOPIC.test(text) || (text.length > 40 && IMPERATIVE.test(text));
}

function overlapsOption(text: string, question: QuestionTarget): boolean {
  const tokens = significant(text);
  return question.options.some((option) =>
    significant(option.label).some((token) => tokens.includes(token)),
  );
}

function significant(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}
