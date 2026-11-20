import type { AcceptedMutation, RevisionFeedPort } from "./types.js";

/** Records mutations for Task 087. This package does not invalidate tasks itself. */
export class LocalRevisionFeed implements RevisionFeedPort {
  readonly batches: { changeSetId: string; mutations: readonly AcceptedMutation[] }[] = [];

  accept(batch: { readonly changeSetId: string; readonly mutations: readonly AcceptedMutation[] }): void {
    this.batches.push({ changeSetId: batch.changeSetId, mutations: batch.mutations });
  }

  get invalidated(): readonly AcceptedMutation[] {
    return this.batches.flatMap((batch) => batch.mutations.filter((mutation) => mutation.invalidateTasks));
  }
}
