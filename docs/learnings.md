# Learnings

## UX Fixes — 2026-02-17

### Subagent `close` vs `exit` events
Node.js `close` event on child processes waits for ALL stdio streams to end — including from grandchild processes that inherit the file descriptors. The `exit` event fires when the process itself terminates. If you're spawning a process that itself spawns children (like `pi` running bash commands), use `exit` or the parent will hang indefinitely.

### Subagents can silently fail
Subagents sometimes return empty output without error. The subagent dispatched for state persistence (Task 7) did partial work (modified files) but didn't commit and returned no output. Always check `git status` after a subagent returns empty, and be ready to finish the work manually.

### `process.cwd()` is shared across vitest test files
Adding file I/O to production code (like writing `.pi/superpowers-state.json` relative to `process.cwd()`) can break unrelated tests that don't use temp CWDs. When production code reads/writes files based on CWD, every test file that exercises that code path needs CWD isolation. The fix: have shared test helpers (like `createFakePi`) automatically call `withTempCwd()` so all tests get isolation by default.

### Double-processing buffer on exit
When draining a line-buffered stream after process exit, don't process the buffer both immediately AND after a timeout delay — the buffer isn't cleared by `processLine`, so the same partial line gets processed twice. Use a single drain point.

## v0.3.0 Hardening Sprint — 2026-02-18

### Node.js `proc.killed` is unreliable for SIGKILL escalation
`proc.killed` is set to `true` immediately after `.kill()` is called, NOT when the process actually exits. So `if (!proc.killed) proc.kill("SIGKILL")` after a prior SIGTERM will never fire. Fix: use `try { proc.kill("SIGKILL") } catch {}` — always attempt SIGKILL after the grace period; sending a signal to a dead process is harmless.

### `LANG` prefix matching leaks secrets
Using `"LANG"` as a `startsWith` prefix in an env var allowlist matches `LANGCHAIN_API_KEY`, `LANGSMITH_API_KEY`, etc. Always use explicit var names for locale vars (`LANG`, `LANGUAGE`) and only prefix-match `LC_`.

### `fs.existsSync` doesn't mean it's a directory
`existsSync` returns `true` for files and symlinks, not just directories. When validating a cwd for `spawn()`, use `fs.statSync(path).isDirectory()` wrapped in try/catch.

### Biome auto-fix can be aggressive
`biome check --write` reformatted code across 6 files in one run. Always re-run the full test suite after lint fixes — formatting changes can subtly break things.

### TDD guard tracks RED-PENDING phase strictly
The TDD guard fires if you write production code after writing tests but before it sees a test run. It fires even if you did run tests and the output was truncated/pruned. Just acknowledge and proceed — the guard is intentionally strict to prevent skipping the RED step.

## Specs/Plans Path Convention — 2026-07-23

### Suffix-based artifact detection was silently broken
The workflow tracker detected plan artifacts via a `*-implementation.md` filename suffix, but `writing-plans` told agents to name plans `YYYY-MM-DD-<feature>.md` (no `-implementation` suffix). So most plan writes were never detected as artifacts — the phase wouldn't advance, boundary prompts wouldn't fire. The fix wasn't to align the suffix; it was to switch to **directory-based** detection (`docs/superpowers/plans/` → plan, `docs/superpowers/specs/` → brainstorm). Lesson: when a detection signal and an instruction can drift apart, prefer a structural signal (directory) over a lexical one (filename suffix) so they can't disagree.

### Strict per-phase boundaries are stricter than they look
Tightening "any file under `docs/plans/` is fine during thinking phases" to "brainstorm may only write to `specs/`, plan only to `plans/`" is a real behavior change, not just a path move. An agent that previously wrote a plan document during the brainstorm phase (or a spec during plan) would now get a process violation. When moving from one shared directory to per-phase directories, the allowlist must become per-phase too — otherwise you've tightened enforcement without meaning to. Lock it in with a test that asserts the cross-dir write is rejected.
