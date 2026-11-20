import { CorpusShapeError, DuplicateQuestionIdError, OrphanCriterionError, PrerequisiteCycleError } from "./errors.js";
import type { ConflictAsymmetry, LoadedQuestion } from "./types.js";

export interface GraphIntegrity {
  readonly questions: readonly LoadedQuestion[];
  readonly asymmetries: readonly ConflictAsymmetry[];
}

export function normalizeQuestionGraph(questions: readonly LoadedQuestion[]): GraphIntegrity {
  const byId = new Map<string, LoadedQuestion>();
  for (const question of questions) {
    const existing = byId.get(question.id);
    if (existing) {
      throw new DuplicateQuestionIdError(
        `Duplicate question ID ${question.id} in ${existing.source_file} and ${question.source_file}`,
        { filePath: question.source_file, questionId: question.id },
      );
    }
    byId.set(question.id, question);
  }

  const asymmetries: ConflictAsymmetry[] = [];
  const conflicts = new Map<string, Set<string>>();
  for (const question of questions) {
    if (new Set(question.conflicts_with).size !== question.conflicts_with.length) {
      throw new CorpusShapeError(
        `Question ${question.id} repeats a conflicts_with id in ${question.source_file}`,
        { filePath: question.source_file, questionId: question.id },
      );
    }
    const set = new Set(question.conflicts_with);
    if (set.has(question.id)) {
      throw new CorpusShapeError(`Question ${question.id} conflicts with itself in ${question.source_file}`, {
        filePath: question.source_file,
        questionId: question.id,
      });
    }
    if (question.requires.includes(question.id)) {
      throw new CorpusShapeError(`Question ${question.id} requires itself in ${question.source_file}`, {
        filePath: question.source_file,
        questionId: question.id,
      });
    }
    conflicts.set(question.id, set);
  }

  for (const question of questions) {
    const own = conflicts.get(question.id);
    if (!own) continue;
    for (const otherId of question.conflicts_with) {
      const other = byId.get(otherId);
      if (!other) continue;
      const peer = conflicts.get(otherId);
      if (!peer) continue;
      if (!peer.has(question.id)) {
        asymmetries.push({
          leftId: question.id,
          leftFile: question.source_file,
          rightId: otherId,
          rightFile: other.source_file,
        });
        peer.add(question.id);
      }
    }
  }

  const normalized = questions.map((question) => {
    const set = conflicts.get(question.id);
    const conflictsWith = set ? [...set].sort() : [];
    return { ...question, conflicts_with: conflictsWith };
  });
  return { questions: normalized, asymmetries };
}

export function findPrerequisiteCycle(questions: readonly LoadedQuestion[]): string[] | null {
  const requires = new Map(questions.map((question) => [question.id, question.requires]));
  const color = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const state = color.get(id);
    if (state === "done") return null;
    if (state === "visiting") {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    color.set(id, "visiting");
    stack.push(id);
    for (const next of requires.get(id) ?? []) {
      if (!requires.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    color.set(id, "done");
    return null;
  };

  for (const question of questions) {
    const cycle = visit(question.id);
    if (cycle) return cycle;
  }
  return null;
}

export function assertAcyclic(questions: readonly LoadedQuestion[]): void {
  const cycle = findPrerequisiteCycle(questions);
  if (!cycle) return;
  const origin = questions.find((question) => question.id === cycle[0]);
  throw new PrerequisiteCycleError(`Prerequisite cycle: ${cycle.join(" -> ")}`, {
    filePath: origin?.source_file ?? "",
    questionId: cycle[0],
  });
}

export function assertGraphTargets(questions: readonly LoadedQuestion[]): void {
  const ids = new Set(questions.map((question) => question.id));
  for (const question of questions) {
    for (const target of question.requires) {
      if (!ids.has(target)) {
        throw new CorpusShapeError(
          `Question ${question.id} requires missing question ${target} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
    }
    for (const target of question.conflicts_with) {
      if (!ids.has(target)) {
        throw new CorpusShapeError(
          `Question ${question.id} conflicts_with missing question ${target} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
    }
    if (new Set(question.requires).size !== question.requires.length) {
      throw new CorpusShapeError(`Question ${question.id} repeats a requires id in ${question.source_file}`, {
        filePath: question.source_file,
        questionId: question.id,
      });
    }
  }
}

export function assertCriterionIntegrity(questions: readonly LoadedQuestion[]): void {
  const owners = new Map<string, LoadedQuestion>();
  for (const question of questions) {
    const local = new Set<string>();
    for (const criterion of question.criteria) {
      if (local.has(criterion)) {
        throw new OrphanCriterionError(
          `Duplicate criterion key ${criterion} on ${question.id} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
      local.add(criterion);
      const prior = owners.get(criterion);
      if (prior) {
        throw new OrphanCriterionError(
          `Orphan or duplicate criterion key ${criterion} on ${prior.id} and ${question.id}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
      owners.set(criterion, question);
    }
  }

  for (const question of questions) {
    for (const criterion of question.invalidates_on_change) {
      if (!owners.has(criterion)) {
        throw new OrphanCriterionError(
          `Orphan criterion key ${criterion} on ${question.id} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
    }
    for (const clause of question.applies_when) {
      if (!owners.has(clause.criterion)) {
        throw new OrphanCriterionError(
          `Orphan criterion key ${clause.criterion} on ${question.id} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
    }
    for (const example of question.positive_examples) {
      const keys = Object.keys(example.settles);
      if (keys.length === 0) {
        throw new OrphanCriterionError(
          `Positive example on ${question.id} settles no criteria in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
      for (const key of keys) {
        if (!question.criteria.includes(key)) {
          throw new OrphanCriterionError(
            `Orphan criterion key ${key} on ${question.id} in ${question.source_file}`,
            { filePath: question.source_file, questionId: question.id },
          );
        }
      }
    }
  }
}
