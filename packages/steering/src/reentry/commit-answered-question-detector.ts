import {
  combinedCommitOffer,
  looksAnsweredOffer,
  questionRecap,
  retiredQuestionNote,
  taskOnlyOffer,
  verifyCommitOffer,
} from "./messages.js";
import { SEVEN_DAYS_MS, parseTime } from "./time.js";
import type {
  CommitAnsweredMatch,
  FailedTaskRecord,
  ObservedCommit,
  OpenQuestionRecord,
  QuestionRecap,
  RetiredQuestion,
} from "./types.js";

export interface DetectCommitInput {
  readonly nowIso: string;
  readonly commits: readonly ObservedCommit[];
  readonly failedTasks: readonly FailedTaskRecord[];
  readonly questions: readonly OpenQuestionRecord[];
}

export interface DetectCommitResult {
  readonly matches: readonly CommitAnsweredMatch[];
  readonly retired: readonly RetiredQuestion[];
  readonly recaps: readonly QuestionRecap[];
}

export class CommitAnsweredQuestionDetector {
  detect(input: DetectCommitInput): DetectCommitResult {
    return detectCommitAnsweredQuestions(input);
  }
}

export function detectCommitAnsweredQuestions(input: DetectCommitInput): DetectCommitResult {
  const now = parseTime(input.nowIso);
  const retired: RetiredQuestion[] = [];
  const retiredIds = new Set<string>();
  const recaps: QuestionRecap[] = [];
  const activeQuestions: OpenQuestionRecord[] = [];

  for (const question of input.questions) {
    const opened = parseTime(question.openedAt);
    const olderThanAWeek = now !== null && opened !== null && now - opened > SEVEN_DAYS_MS;
    if (olderThanAWeek && question.revalidation === "obsolete") {
      const note = retiredQuestionNote(question.id, question.prompt);
      retired.push({ questionId: question.id, note });
      retiredIds.add(question.id);
      continue;
    }
    activeQuestions.push(question);
  }

  const matches: CommitAnsweredMatch[] = [];
  const seen = new Set<string>();

  for (const commit of input.commits) {
    const tasks = input.failedTasks.filter((task) => taskMatchesCommit(task, commit));
    const questions = activeQuestions.filter((question) => questionMatchesCommit(question, commit));
    if (tasks.length === 0 && questions.length === 0) {
      pushRecaps(recaps, activeQuestions, commit, null);
      continue;
    }
    if (tasks.length > 0 && questions.length > 0) {
      for (const task of tasks) {
        for (const question of questions) {
          pushMatch(matches, seen, commit, task.id, question.id, overlapFiles(commit, task, question));
          pushRecaps(recaps, [question], commit, task.id);
        }
      }
      continue;
    }
    for (const task of tasks) {
      pushMatch(matches, seen, commit, task.id, null, overlapFiles(commit, task, null));
    }
    for (const question of questions) {
      pushMatch(matches, seen, commit, null, question.id, overlapFiles(commit, null, question));
      pushRecaps(recaps, [question], commit, null);
    }
  }

  for (const question of activeQuestions) {
    if (recaps.some((item) => item.questionId === question.id)) continue;
    if (!question.decisionContext) continue;
    recaps.push({
      questionId: question.id,
      recap: questionRecap({
        decisionContext: question.decisionContext,
        neededByTaskId: question.neededByTaskId,
        sinceLabel: question.sinceLabel,
        file: null,
        effectHint: question.effectHint,
      }),
    });
  }

  return { matches, retired, recaps };
}

function pushRecaps(
  recaps: QuestionRecap[],
  questions: readonly OpenQuestionRecord[],
  commit: ObservedCommit,
  taskId: string | null,
): void {
  for (const question of questions) {
    if (!question.decisionContext) continue;
    if (recaps.some((item) => item.questionId === question.id)) continue;
    const file = question.targetFiles.find((target) => commit.files.some((changed) => pathsMatch(changed, target))) ?? null;
    if (!file && taskId === null && !questionMatchesCommit(question, commit)) continue;
    recaps.push({
      questionId: question.id,
      recap: questionRecap({
        decisionContext: question.decisionContext,
        neededByTaskId: question.neededByTaskId,
        sinceLabel: question.sinceLabel,
        file,
        effectHint: question.effectHint,
      }),
    });
  }
}

function pushMatch(
  matches: CommitAnsweredMatch[],
  seen: Set<string>,
  commit: ObservedCommit,
  taskId: string | null,
  questionId: string | null,
  files: readonly string[],
): void {
  const matchId = `${commit.sha}:${taskId ?? "-"}:${questionId ?? "-"}`;
  if (seen.has(matchId)) return;
  seen.add(matchId);
  const shortSha = commit.sha.slice(0, 4);
  const offers: string[] = [];
  if (taskId && questionId) {
    offers.push(combinedCommitOffer(commit.subject, taskId, questionId));
    offers.push(verifyCommitOffer(taskId));
    offers.push(looksAnsweredOffer(shortSha));
  } else if (taskId) {
    offers.push(verifyCommitOffer(taskId));
    offers.push(taskOnlyOffer(commit.subject, taskId, null));
  } else if (questionId) {
    offers.push(
      `Looks like your commit '${commit.subject}' already resolved Question ${questionId} — Mark verified or Keep open?`,
    );
    offers.push(looksAnsweredOffer(shortSha));
  }
  matches.push({
    matchId,
    commitSha: commit.sha,
    shortSha,
    commitSubject: commit.subject,
    taskId,
    questionId,
    overlappingFiles: files,
    offers,
    autoClosed: false,
    resolution: "awaiting_confirmation",
  });
}

function taskMatchesCommit(task: FailedTaskRecord, commit: ObservedCommit): boolean {
  if (task.failingChecks.length === 0 || task.writeScope.length === 0) return false;
  const inScope = commit.files.some((file) => task.writeScope.some((scope) => pathsMatch(file, scope)));
  const inCheck = commit.files.some((file) => task.failingChecks.some((check) => pathsMatch(file, check)));
  return inScope && inCheck;
}

function questionMatchesCommit(question: OpenQuestionRecord, commit: ObservedCommit): boolean {
  if (question.targetFiles.length === 0) return false;
  return commit.files.some((file) => question.targetFiles.some((target) => pathsMatch(file, target)));
}

function overlapFiles(
  commit: ObservedCommit,
  task: FailedTaskRecord | null,
  question: OpenQuestionRecord | null,
): readonly string[] {
  const files = commit.files.filter((file) => {
    const taskHit = task
      ? task.writeScope.some((scope) => pathsMatch(file, scope)) ||
        task.failingChecks.some((check) => pathsMatch(file, check))
      : false;
    const questionHit = question ? question.targetFiles.some((target) => pathsMatch(file, target)) : false;
    return taskHit || questionHit;
  });
  return files;
}

export function pathsMatch(file: string, pattern: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const spec = pattern.replaceAll("\\", "/");
  if (spec.endsWith("/**")) {
    const prefix = spec.slice(0, -3).replace(/\/$/, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  if (spec.includes("*")) {
    const expression = `^${spec
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`;
    return new RegExp(expression).test(normalized);
  }
  return normalized === spec;
}
