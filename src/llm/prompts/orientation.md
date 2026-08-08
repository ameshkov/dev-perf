# Repository orientation

Analyze the repository at {{repo}} for dev-perf. This session
establishes the repository context that the contributor analysis uses
later. The analysis covers {{branch}}; scope your exploration to it.

Changes to the following paths are excluded from the analysis — do not
attribute or weigh them, even when they surface while you inspect the
repository:
{{ignoredPaths}}

Explore the repository with the read tools and read-only git commands
as needed. Produce a compact repository context covering:

- Tech stack: languages, frameworks, and key dependencies (README,
  manifests, config files).
- Main modules or directories and what each does.
- Conventions: code style, testing, commit message style.

Keep the context under 500 words. Reply with ONLY the repository
context as your final text.

When the analysis is complete, call the devperf_report tool with the
final analysis before finishing the session; no other output format is
accepted.
