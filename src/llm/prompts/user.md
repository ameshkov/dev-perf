# Contribution analysis

Analyze the git contributions of {{name}} ({{email}}){{identityNote}} in
the repository at {{repo}}. The analysis covers commits whose author
date lies in the range {{since}} to {{until}} (UTC) on {{branch}}.

{{retryAdvice}}

{{scopeNote}}

The following paths are excluded from the analysis — do not attribute
or weigh changes inside them, even when they appear while you inspect
the commits:
{{ignoredPaths}}

The following commits are excluded from the analysis — do not attribute
or weigh them, even when they appear in the commit list you inspect:
{{ignoredCommits}}

## Repository context

{{repoContext}}

## Commits by {{name}} in the analyzed range ({{count}})

Newest first; each line lists the abbreviated sha, author date,
subject, total added/removed lines, and the files changed (merge
commits have no file list).

{{commits}}

The repository is shared by concurrent sessions and must stay
untouched: never check out a different branch or change the working
tree or any files.

Inspect the commits with the read tools and read-only commands (git
show, git log, git diff, git blame, git status, git branch, git tag,
git rev-parse, git rev-list, git shortlog, git ls-tree, git ls-files,
git grep, and the file/text commands ls, cat, tail, head, wc, file,
grep, sort, uniq, cut, diff) as needed, and assess what cannot be
counted from git history alone: work types, complexity, size, impacted
areas, and observable quality signals or risk flags.
Quality signals and risk flags must be chosen from the fixed value
lists in the devperf_report tool schema; only what is observable in
the repository, never inferred review status.

Split the work into distinct contributions (one feature, one bug fix,
one refactor, and so on); changes of different complexity or size are
separate contributions rather than averaged into one.

When the analysis is complete, call the devperf_report tool with the
final analysis before finishing the session; no other output format is
accepted.
