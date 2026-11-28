import {
  HUMAN_AUTHOR_MODE_VALUE,
  HUMAN_FIX_TRAILER_AUTHOR_MODE,
  HUMAN_FIX_TRAILER_TASK,
  STATIC_AUDIT,
} from "./constants.js";
import { VerificationFailedError } from "./errors.js";
import type { GitRepo } from "./git.js";
import type { CleanVerifierHarnessPort } from "./ports.js";
import type { HumanFixStateDb } from "./state-db.js";
import { transitionHumanDone } from "./states.js";
import type { CleanVerifyResult, DeveloperIdentity } from "./types.js";

export interface HumanFixCleanVerifyInput {
  readonly taskId: string;
  readonly repo: GitRepo;
  readonly baseSha: string;
  readonly message?: string;
  readonly paths?: readonly string[];
}

export class HumanFixCleanVerifier {
  constructor(
    private readonly verifier: CleanVerifierHarnessPort,
    private readonly state: HumanFixStateDb,
  ) {}

  async verifyAndContinue(input: HumanFixCleanVerifyInput): Promise<CleanVerifyResult> {
    const task = this.state.requireTask(input.taskId);
    transitionHumanDone(task.state);
    const identity = input.repo.readIdentity();
    const commitSha = input.repo.commitWithHumanTrailers(
      identity,
      input.taskId,
      input.message ?? `human fix ${input.taskId}`,
      input.paths,
    );
    const authorFromCommit = input.repo.parseAuthor(commitSha);
    if (authorFromCommit.name !== identity.name || authorFromCommit.email !== identity.email) {
      throw new VerificationFailedError(["author_identity"]);
    }
    const trailerMode = input.repo.parseTrailer(commitSha, HUMAN_FIX_TRAILER_AUTHOR_MODE);
    const trailerTask = input.repo.parseTrailer(commitSha, HUMAN_FIX_TRAILER_TASK);
    if (trailerMode !== HUMAN_AUTHOR_MODE_VALUE || trailerTask !== input.taskId) {
      throw new VerificationFailedError(["trailers"]);
    }
    const changed = input.repo.diffNameOnly(input.baseSha, commitSha);
    this.state.tagHumanPaths(input.taskId, changed);
    this.state.setTaskState(input.taskId, STATIC_AUDIT);
    const result = await this.verifier.run(input.taskId, commitSha);
    if (!result.ok) {
      throw new VerificationFailedError(result.stages.filter((s) => !s.ok).map((s) => s.id));
    }
    this.state.setVerificationStatus(input.taskId, "pass");
    return {
      ...result,
      author: authorFromCommit,
      trailers: {
        [HUMAN_FIX_TRAILER_AUTHOR_MODE]: HUMAN_AUTHOR_MODE_VALUE,
        [HUMAN_FIX_TRAILER_TASK]: input.taskId,
      },
    };
  }

  preserveAuthorshipHint(author: DeveloperIdentity, paths: readonly string[]): string {
    const fileList = paths.map((p) => `<${p}>`).join(", ");
    return `Preserve developer's human-fixed implementation in ${fileList} unless contradicting a newer decision (${author.name} <${author.email}>)`;
  }
}