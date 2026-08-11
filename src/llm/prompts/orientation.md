# Repository orientation

Analyze the repository at {{repo}} for dev-perf. This session
establishes the repository context that the contributor analysis uses
later. The analysis covers {{branch}}; scope your exploration to it.

{{retryAdvice}}

Changes to the following paths are excluded from the analysis — do not
attribute or weigh them, even when they surface while you inspect the
repository:
{{ignoredPaths}}

The following commits are excluded from the analysis — do not attribute
or weigh them, even when they surface while you inspect the repository:
{{ignoredCommits}}

Explore the repository with the read tools and read-only git commands
as needed. The repository is shared and must stay untouched: never
check out a different branch or change the working tree. Produce a
compact repository context covering:

- Tech stack: languages, frameworks, and key dependencies (README,
  manifests, config files).
- Main modules or directories and what each does.
- Conventions: code style, testing, commit message style.

Keep the context under 500 words. Reply with ONLY the repository
context as your final text.

When the analysis is complete, call the devperf_report tool with the
final analysis before finishing the session; no other output format is
accepted.
