# Workflow Tracker Skip Confirmation (No Silent Skips)

**Date:** 2026-02-12
**Status:** Draft (validated in chat)

## Problem

The workflow tracker currently marks earlier phases as `skipped` automatically when the user jumps ahead (e.g. entering `execute` without `plan`). This causes two issues:

1. **Silent skipping**: users can bypass phases without noticing, defeating the purpose of tracking.
2. **Downstream blind spots**: phases like `verify`, `review`, and `finish` can be missed in practice and the tracker does not reliably force an explicit decision.

The desired behavior is **not** a “nanny” that forbids skipping; it is a system that **never skips silently** and always asks for confirmation.

## Goals

- No workflow phase should be marked `skipped` without an explicit user choice.
- When a user attempts to transition to a later phase with missing earlier phases, the system must **ask** whether to skip.
- The same applies to “completion actions”: entering `finish`, `git commit`, `git push`, and `gh pr create`.
- Keep conversational context clean: prompts should be **UI-only** and minimal, avoiding long assistant messages.

## Non-goals

- Hard enforcement of running tests/review (skipping remains allowed).
- Automatically injecting or submitting `/skill:*` commands.
- Auto-resuming a previously blocked transition after completing a missing phase (user re-issues the action).

## UX: Skip confirmation prompts (hybrid)

When missing phases are detected before a requested target phase:

- If exactly **one** phase is missing, prompt directly:
  - **Do `<missing>` now**
  - **Skip `<missing>`**
  - **Cancel**

- If **2+** phases are missing, use a hybrid prompt to reduce click fatigue:
  1) Show a summary prompt listing the missing phases:
     - **Review skips one-by-one** (recommended)
     - **Skip all and continue**
     - **Cancel**
  2) If the user chooses “Review one-by-one”, ask for each missing phase in order.

If the user chooses **Do now**, the extension emits a single short instruction line, e.g.

> Next: run `/skill:verification-before-completion` (you can add any text after it).

…and blocks the original transition/tool call.

## Architecture: where logic lives

### WorkflowTracker stays UI-free

`extensions/workflow-monitor/workflow-tracker.ts` remains a pure state machine with no access to `ctx.ui`.

Change in semantics:

- `advanceTo(target)` must **not** mark earlier phases as `skipped`.
- Skipping must be explicit via `skipPhase()` / `skipPhases()`.

### Extension layer owns confirmation gates

All UI prompting and blocking happens in the extension entrypoint (`extensions/workflow-monitor.ts`) because it has access to `ctx.ui.select()`.

We introduce a centralized gate function conceptually:

- `attemptTransition(targetPhase, ctx)`
  - compute missing earlier phases
  - show UI prompts as needed
  - on “Skip”, call tracker skip methods
  - on “Do now” / “Cancel”, block
  - on success, call `tracker.advanceTo(targetPhase)`

This gate is used consistently for:

- user phase intents from `pi.on("input")`
- completion actions from `pi.on("tool_call")`

## Phase intent detection

To reduce false negatives (and support “skill + extra text”):

- Treat `/skill:<name>` as detected when it appears at the start of a line, even if followed by text.
- (Optional hardening) also detect injected XML blocks of the form `<skill name="...">…</skill>` if present in user input.

## Completion actions: commit/push/PR/finish

### Finish

Entering `finish` triggers the same missing-phase check for all earlier phases.

### git commit: imply verify

For `git commit`, the implied target is **verify**.

- If `verify` is unresolved (`pending|active`), prompt to **Do verify now** or **Skip verify**.
- Skipping verify should not pretend tests were run.

### git push / gh pr create: imply review

For `git push` and `gh pr create`, the implied target is **review**.

- Requires `verify` and `review` to be resolved (complete or explicitly skipped), with the same hybrid prompting flow.

## VerificationMonitor: waiver support

To avoid re-blocking the same commit immediately after an explicit skip, add a separate waiver flag:

- `verificationWaived: boolean`
- `recordVerificationWaiver()` sets it true
- `checkCommitGate()` allows commit/push/PR if `verified || verificationWaived`
- `onSourceWritten()` resets both `verified=false` and `verificationWaived=false`

This preserves semantic correctness while supporting explicit opt-out.

## Testing strategy

Add tests to cover:

1. **WorkflowTracker** no longer auto-skips earlier phases on `advanceTo()`.
2. **Skip methods** mark phases as skipped only when called.
3. **Intent detection** for `/skill:<name>` with trailing text (and optional `<skill name=…>` form).
4. **Gating flow**:
   - single missing phase prompt
   - multi-missing hybrid summary prompt
   - skip-all path
   - cancel path

(Where direct UI testing is difficult, test the pure functions: missing-phase computation, intent parsing, and the decision logic as a unit with mocked UI responses.)

## Rollout notes

- This changes the original tracker design from “informational only” to “informational + confirmation gate”.
- Skipping remains fully supported, but is now explicit and discoverable.
- The gate should be disabled automatically when `ctx.hasUI === false` (headless), falling back to warnings without mutating state to `skipped`.
