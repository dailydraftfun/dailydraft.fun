# CI coverage and failure artifacts

Pull-request CI keeps broad repository work remote while making changed code
reviewable:

- Turbo still runs lint, typecheck, tests, and builds only for affected
  workspaces.
- `bun run coverage:changed` resolves added and modified executable files from
  `TURBO_SCM_BASE...TURBO_SCM_HEAD`, instruments only those files, and runs the
  owning workspace's Bun tests.
- Each affected workspace must cover at least 80% of changed executable lines
  and 80% of branch outcomes. A changed source file that is never loaded by its
  tests fails closed.
- Test, spec, Journey, declaration, generated, build-output, and configuration
  files do not count as changed executable code. A pull request without
  executable workspace changes skips coverage work.
- A workspace with changed executable code but no `test` script fails with an
  explicit setup error.
- Editing inside an existing conditional measures every outcome attached to
  that touched branch, including outcomes introduced before the current pull
  request.

The coverage-gate fixture test executes the real Bun preload/instrumentation
path and proves both a covered pass and an under-covered failure on every CI
run. Full test, typecheck, build, coverage, and browser checks are not required
on a developer laptop.

## Failure artifacts

Failed affected tests or changed-code coverage publish `ci-failure-*` for seven
days. The artifact contains a one-megabyte-capped test log, the coverage target
manifest, raw Istanbul counters, and JSON/Markdown coverage summaries.

Failed Journey browser checks publish `journey-failure-*` for seven days.
Playwright's existing failure-only screenshots and retained traces are uploaded
from `apps/app/test-results`. Successful runs do not retain either artifact.
