# Oversight Model (Skills + Runtime Enforcement)

pi-superpowers-plus uses **defense in depth**:

- **Skills** describe the intended workflow (what to do, in what order).
- The **workflow-monitor extension** observes tool calls/results and enforces guardrails at runtime (what actually happens).

This is intentional: written instructions are easy to ignore; runtime feedback is harder to miss.

## Two Violation Categories

### 1) Process violations (workflow phase boundaries)
These are violations of *where you are* in the workflow.

Example:
- Writing or editing non-plan files while in **Brainstorm** or **Plan** phase.

In thinking phases, the only allowed writes are to:
- `docs/superpowers/specs/` (during brainstorm)
- `docs/superpowers/plans/` (during plan)

### 2) Practice violations (quality practices)
These are violations of *how you work*.

Examples:
- **TDD** write-order violations (writing production source before a failing test).
- **Debug** violations (fix-without-investigation, excessive fix attempts).

## Escalation: Warning → Hard Block (with user override)

For both categories, the extension keeps a **per-session strike counter**.

- **1st strike:** warning is injected into tool output.
- **2nd strike:** in interactive sessions, the extension prompts via `ui.select` and can hard-block the action.

The prompt offers:
- **Yes, continue** (override): allows the action and resets the strike counter for that category.
- **No, stop**: blocks the tool call (returns `{ blocked: true }`).

### Non-interactive sessions
If `ctx.hasUI` is false (no UI available), the extension cannot prompt, so it does not hard-block. It still injects warnings.

## Session lifetime / reset behavior

Strike counters reset when the workflow-monitor session state resets (e.g. on session switch / session clear events). A user override also resets the strike counter for the chosen category.

## Why this exists

The goal is not to punish mistakes; it is to:
- surface guardrails immediately,
- prevent repeated violations from becoming the default behavior,
- and keep the human in control via explicit override when needed.
