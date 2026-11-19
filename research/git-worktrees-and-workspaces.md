# Research: Git, worktrees and messy workspaces

Question: should Git be mandatory, and how can a harness create isolated worktrees when the developer's folder is empty, not a repo, or full of uncommitted work, without touching that work? Design that uses this: [workspace and Git](../workspace-and-git.md).

## Should Git be mandatory?

| Option | Parallel isolation | Checkpoints and undo | Merge of parallel work | Export as branches | Verdict |
|---|---|---|---|---|---|
| Git (bundled) | Worktrees share one object store; cheap | Commits and refs | Three-way merge, conflict detection | Native | **Chosen** |
| Plain folder copies | Full copies; slow for big repos | Manual snapshots | No real merge; last write wins | No | Breaks parallel work |
| Jujutsu (jj) | Git-compatible backend | Excellent | Good | Via Git | Niche; can come later on top of Git |
| Editor-style checkpoints (file snapshots) | No | Per-file only | No | No | Fine for one agent, not for many |

Every feature the owner wants (parallel workers, safe undo, “export my unfinished work”, crash recovery, coexisting with VS Code) is a Git feature. Making Git invisible matters more than making it optional: Git for Windows publishes **MinGit**, a minimal portable distribution intended for applications to bundle. [MinGit](https://github.com/git-for-windows/git/wiki/MinGit)

## Worktrees

- `git worktree add --detach <path> <commit>` creates another working directory sharing the same repository; `prune` cleans stale entries; `repair` fixes links after moves. [git-worktree](https://git-scm.com/docs/git-worktree)
- Each worktree has its own `HEAD`, index and files. **Ignored and untracked files are not copied**, so `.env`, `node_modules` and local config are absent. That's why the design needs an environment manifest.
- Git's own docs warn that multiple checkout support for **submodules is incomplete**; treat submodule repos as a tested special case.
- Sparse checkout (cone mode) limits a worktree to listed directories for very large repos. [git-sparse-checkout](https://git-scm.com/docs/git-sparse-checkout)
- Dependency installs per worktree are the main cost. pnpm's content-addressable store hard-links packages, making repeated installs cheap; npm's cache helps less. [pnpm motivation](https://pnpm.io/motivation)

## Snapshotting dirty work without touching it

- `git stash` modifies the working tree; `git stash create` doesn't, but it ignores untracked files. [git-stash](https://git-scm.com/docs/git-stash)
- A temporary index avoids both problems: set `GIT_INDEX_FILE` to a scratch file, `git read-tree HEAD`, `git add -A`, `git write-tree`, then `git commit-tree <tree> -p HEAD` and store it under a private ref. The developer's real index and files are untouched. [git-commit-tree](https://git-scm.com/docs/git-commit-tree) · [environment variables](https://git-scm.com/book/en/v2/Git-Internals-Environment-Variables)

## Detecting unsafe states

| State | Detect by |
|---|---|
| Merge in progress | `.git/MERGE_HEAD` |
| Rebase in progress | `.git/rebase-merge/` or `.git/rebase-apply/` |
| Cherry-pick / revert | `CHERRY_PICK_HEAD` / `REVERT_HEAD` |
| Detached HEAD | `git symbolic-ref -q HEAD` fails |
| Unborn branch (no commits) | `git rev-parse --verify HEAD` fails |
| Shallow clone | `git rev-parse --is-shallow-repository` |

## Predicting conflicts without touching anything

`git merge-tree --write-tree <a> <b>` (Git 2.38+) performs a merge entirely in the object store and reports conflicts, so the harness can check whether a landing or base sync would conflict before doing it. [git-merge-tree](https://git-scm.com/docs/git-merge-tree)

When updating a checked-out branch, Git itself refuses a merge or fast-forward that would overwrite uncommitted changes, and proceeds when dirty files are untouched by the update. The harness relies on this, and still checks first so it can explain the situation instead of showing a Git error.

## Secrets before the first commit

Before a baseline or snapshot commit, scan for secrets with a rules-based scanner such as gitleaks (regex plus entropy rules). [gitleaks](https://github.com/gitleaks/gitleaks)

## Windows

- Classic path limit is 260 characters; `core.longpaths=true` lets Git handle longer paths, and short worktree roots avoid tool failures. [Git for Windows FAQ](https://github.com/git-for-windows/git/wiki/FAQ)
- Antivirus real-time scanning slows dependency-heavy folders; Defender exclusions require admin rights.
- Line endings follow `.gitattributes` and `core.autocrlf`.

## To measure

- Worktree creation and dependency install time on a 30k-line repo and a large monorepo, cold and warm.
- Disk use per attempt with pnpm versus npm.
