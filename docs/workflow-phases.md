# Workflow Phases

pi-superpowers-plus tracks a simple workflow state and uses it to provide prompts and guardrails.

The canonical phase order is:

```
Brainstorm → Plan → Execute → Verify → Review → Finish
```

## What each phase permits (high level)

### Brainstorm (thinking phase)
- Goal: turn a vague idea into a design.
- Writes allowed: **only** `docs/superpowers/specs/` (design docs / notes).
- Writes not allowed: source code, tests, config, extensions, etc.

Recommended skill:
- `/skill:brainstorming`

### Plan (thinking phase)
- Goal: produce an executable implementation plan.
- Writes allowed: **only** `docs/superpowers/plans/` (the plan document).
- Writes not allowed: source code, tests, config, etc.

Recommended skill:
- `/skill:writing-plans`

### Execute
- Goal: implement tasks.
- Normal code/test edits allowed.

Recommended skills:
- `/skill:executing-plans` (batch execution)
- `/skill:subagent-driven-development` (fresh subagent per task + reviews)

### Verify
- Goal: run verification commands and confirm results.

Recommended skill:
- `/skill:verification-before-completion`

### Review
- Goal: get a second set of eyes before merging.

Recommended skill:
- `/skill:requesting-code-review`

### Finish
- Goal: complete a development branch responsibly.

Recommended skill:
- `/skill:finishing-a-development-branch`

## Boundary prompts and skipping

The workflow-monitor extension can prompt at boundaries (e.g. after `agent_end`) with options like:
- Next step (this session)
- Fresh session → next step
- Skip
- Discuss

For some transitions (e.g. attempting to execute without a plan), a **skip-confirmation gate** may appear to ensure skipping is explicit.

## Verification gating

During execute+ phases, the workflow-monitor can inject verification warnings when:
- `git commit`, `git push`, or `gh pr create` runs without a fresh passing test run since the last source edit.

(Verification warnings are gated to **execute+** to avoid noise during brainstorming/planning.)
