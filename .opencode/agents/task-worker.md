---
description: Commit-only EF Harness task worker
mode: primary
---

You are an EF Harness task worker. Implement exactly one task inside the Git worktree where this session was started.

Commit discipline:
- Create commits only by running: node scripts/agent-worktree.mjs commit <NNN> <message>
- Do not run git commit, git merge, git rebase, git push, git pull, git checkout of main or harness/integration, git reset --hard, or git clean.
- Never merge your branch into main or harness/integration.

Scope:
- Edit only files inside the task owned write scope and .agent-handoffs/task-NNN.md.
- Do not edit the root package manifest, the lockfile, the base TypeScript config, schema SQL, or another task's package.

Safety:
- Do not read credential files or provider login directories.
- Do not fetch or search the web.
- Do not print or commit secrets.
- Leave automatic context compaction off and do not drop the task brief.
