# pi-superpowers-plus

![pi-superpowers-plus banner](banner-plus.jpg)

Structured workflow skills and active enforcement extensions for [pi](https://github.com/badlogic/pi-mono).

Your coding agent doesn't just know the rules - it follows them. Skills teach the agent *what* to do (brainstorm before building, write tests before code, verify before claiming done). Extensions enforce it in real time (the TDD monitor watches every file write and warns when you skip the test).

## What You Get When You Install This

**12 workflow skills** that guide the agent through a structured development process - from brainstorming ideas through shipping code.

**3 extensions** that run silently in the background:
- **Workflow Monitor** — enforces TDD discipline, tracks debug cycles, gates commits on verification, tracks workflow phase, and serves reference content on demand.
- **Subagent** — registers a `subagent` tool for dispatching implementation and review work to isolated subprocess agents, with bundled agent definitions and structured results.
- **Plan Tracker** — tracks task progress with a TUI widget.

**After installation**:
- Any time the agent writes a source file without a failing test, it gets a warning injected into the tool result.
- Any time it tries to `git commit` / `git push` / `gh pr create` without passing tests, it gets gated.
- During **Brainstorm**/**Plan**, writes are restricted to `docs/plans/` (writes elsewhere trigger a process violation).
- Repeated violations **escalate**: skill boundary → soft warning → hard block (interactive) → explicit user override.
- On the first tool output of a session (inside a git repo), the agent is shown the **current git branch (or detached HEAD short SHA)**.
- On the first write/edit of a session (inside a git repo), the agent is warned to **confirm it's on the correct branch/worktree** before continuing.

The agent sees these warnings as part of its normal tool output - no configuration needed.

More detail:
- [`docs/oversight-model.md`](docs/oversight-model.md) — how skills + runtime enforcement work together, and how warnings escalate
- [`docs/workflow-phases.md`](docs/workflow-phases.md) — what each workflow phase permits (especially thinking-phase write boundaries)

## Install

```bash
pi install npm:pi-superpowers-plus
```

Or from git:

```bash
pi install git:github.com/coctostan/pi-superpowers-plus
```

Or add to `.pi/settings.json` (project-level) or `~/.pi/agent/config.json` (global):

```json
{
  "packages": ["npm:pi-superpowers-plus"]
}
```

No configuration required. Skills and extensions activate automatically.

## Support

- Questions / support: https://github.com/coctostan/pi-superpowers-plus/discussions
- Bugs: https://github.com/coctostan/pi-superpowers-plus/issues/new/choose
- Feature requests: https://github.com/coctostan/pi-superpowers-plus/issues/new/choose
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Upgrading from `pi-superpowers`

If you're currently using [`pi-superpowers`](https://github.com/coctostan/pi-superpowers), `pi-superpowers-plus` is intended as a drop-in upgrade: you keep the same skill names and workflow, but you also get **active, runtime enforcement** via extensions.

### What stays the same
- The same core workflow skills (e.g. `/skill:brainstorming`, `/skill:writing-plans`, `/skill:executing-plans`, etc.)
- The same "structured workflow" idea and phase order

### What's new in `pi-superpowers-plus`
- **Workflow Monitor extension** that observes tool calls/results and injects warnings directly into output
- **TDD discipline warnings** when writing source code without a failing test first
- **Debug enforcement** escalation after repeated failing tests
- **Verification gating** for `git commit` / `git push` / `gh pr create` until passing tests are run
- **Workflow tracking + boundary prompts** (and `/workflow-next` handoff)
- **Branch safety reminders** (first tool result shows current branch/SHA; first write/edit warns to confirm branch/worktree)
- **Finish-phase reminder prefill** (docs + learnings)
- **Plan Tracker tool** (`plan_tracker`) for task lists + TUI progress

### Migration
Replace `pi-superpowers` with `pi-superpowers-plus` in your config:

```json
{
  "packages": ["npm:pi-superpowers-plus"]
}
```

Notes:
- If you keep both packages enabled, you may get duplicate/competing skill guidance.
- `pi-superpowers-plus` is more "opinionated" at runtime: it will inject warnings into tool output and may gate shipping commands until verification has passed.

### How the skills were cleaned up (leveraging pi)

A core goal of `pi-superpowers-plus` is to keep **skill instructions short and action-oriented**, and rely on pi's runtime capabilities for the "heavy lifting":
- **Extensions** enforce behavior *while you work* (TDD/Debug/Verification monitors, branch safety notices), instead of relying on long written reminders.
- The **TUI** can show state (workflow/TDD) and prompt at boundaries, reducing repeated prose in skills.
- Tools like **`plan_tracker`** store execution state outside the prompt, so skills don't need to carry as much bookkeeping text.

To make this concrete, here's the size of each skill's `SKILL.md` compared to the original [`coctostan/pi-superpowers`](https://github.com/coctostan/pi-superpowers) (approximate KB, at time of writing). Across the shared skills, total `SKILL.md` content went from **67.5KB → 55.8KB** (~**-17%**).

| Skill | pi-superpowers (KB) | pi-superpowers-plus (KB) | Change |
|---|---:|---:|---:|
| `brainstorming` | 2.5 | 2.8 | +10% |
| `dispatching-parallel-agents` | 6.2 | 6.2 | 0% |
| `executing-plans` | 2.7 | 3.3 | +21% |
| `finishing-a-development-branch` | 4.3 | 4.4 | +2% |
| `receiving-code-review` | 6.2 | 5.9 | -5% |
| `requesting-code-review` | 2.9 | 3.0 | +2% |
| `subagent-driven-development` | 10.2 | 9.6 | -5% |
| `systematic-debugging` | 9.8 | 5.1 | -48% |
| `test-driven-development` | 9.8 | 3.4 | -65% |
| `using-git-worktrees` | 5.5 | 6.1 | +12% |
| `verification-before-completion` | 4.1 | 2.6 | -38% |
| `writing-plans` | 3.3 | 3.5 | +7% |

## The Workflow

The skills guide the agent through a consistent development cycle:

```
Brainstorm → Plan → Execute → Verify → Review → Finish
```

| Phase | Skill | What Happens |
|-------|-------|--------------|
| **Brainstorm** | `/skill:brainstorming` | Refines your idea into a design document via Socratic dialogue |
| **Plan** | `/skill:writing-plans` | Breaks the design into bite-sized TDD tasks with exact file paths and code |
| **Execute** | `/skill:executing-plans` or `/skill:subagent-driven-development` | Works through tasks in batches with review checkpoints |
| **Verify** | `/skill:verification-before-completion` | Runs tests and proves everything works - evidence before claims |
| **Review** | `/skill:requesting-code-review` | Dispatches a reviewer subagent to catch issues before merge |
| **Finish** | `/skill:finishing-a-development-branch` | Presents merge/PR/keep/discard options and cleans up |

The **workflow tracker** shows progress in the TUI status bar as the agent moves through phases:

```
-brainstorm → ✓plan → [execute] → verify → review → finish
```

Phases are detected automatically from skill invocations, artifact writes under `docs/plans/`, and plan tracker initialization. At phase boundaries, the agent is prompted (once) with options to continue, start a fresh session, skip, or discuss.

### Supporting Skills

These skills are used within the main workflow as needed:

| Skill | When It's Used |
|-------|---------------|
| `/skill:test-driven-development` | During execution - enforced by the TDD monitor |
| `/skill:systematic-debugging` | When tests fail repeatedly - enforced by the debug monitor |
| `/skill:using-git-worktrees` | Before execution - creates isolated branch workspace |
| `/skill:dispatching-parallel-agents` | When multiple independent problems need solving concurrently |
| `/skill:receiving-code-review` | When acting on review feedback - prevents blind agreement |

## Extensions

### Workflow Monitor

Runs in the background observing every tool call and result. Zero configuration.

#### TDD Enforcement

Detects when the agent writes production code without a failing test first and injects a violation warning into the tool result. The agent sees it immediately as part of its normal output.

**Tracks the TDD cycle:** RED → GREEN → REFACTOR → idle. Resets on `git commit`.

**TUI widget** shows the current phase, color-coded:
```
TDD: RED          (red)
TDD: GREEN        (green)
TDD: REFACTOR     (accent)
```

#### Debug Enforcement

Activates after **2 consecutive failing test runs** (excluding intentional TDD red verification). When active:
- Warns if the agent writes a fix without reading code first (investigation required)
- Counts fix attempts and escalates warnings at 3+
- Resets on test pass or commit

#### Verification Gating

Blocks `git commit`, `git push`, and `gh pr create` when the agent hasn't run passing tests. Requires a fresh passing test run before shipping. Automatically clears after successful verification.

#### Branch Safety (informational)

Inside a git repo, the workflow monitor also tries to prevent "oops I just edited main" mistakes:
- On the **first tool result** of a session, it injects `📌 Current branch: <branch-or-sha>`.
- On the **first write/edit** of a session, it injects a warning reminding the agent to confirm the branch/worktree with the user.

Outside a git repo, it stays silent.

#### Workflow Tracker

Tracks which workflow phase the agent is in and shows a phase strip in the TUI widget. Detection signals:
- Skill invocations (`/skill:brainstorming`, `/skill:writing-plans`, etc.)
- Artifact writes under `docs/plans/` (`*-design.md` → brainstorm, `*-implementation.md` → plan)
- `plan_tracker` init calls → execute phase
- Passing test runs during verify phase → verify complete

At phase boundaries, prompts the agent once (non-enforcing) with options:
1. **Next step** - continue in the current session
2. **Fresh session** - hand off to a new session via `/workflow-next`
3. **Skip** - skip the next phase
4. **Discuss** - keep chatting

When transitioning into **finish**, the monitor pre-fills the editor with a reminder to consider documentation updates and to capture learnings before merging/shipping.

The `/workflow-next` command starts a new session with artifact context:
```
/workflow-next plan docs/plans/2026-02-10-my-feature-design.md
/workflow-next execute docs/plans/2026-02-11-my-feature-implementation.md
/workflow-next verify
```

Valid phases: `brainstorm`, `plan`, `execute`, `verify`, `review`, `finish`.

#### Reference Tool

Serves detailed guidance on demand, keeping skill files lean while making reference content available when the agent needs it:

```
workflow_reference({ topic: "tdd-rationalizations" })    - Why order matters, excuse table
workflow_reference({ topic: "tdd-examples" })             - Good/bad code examples, bug fix walkthrough
workflow_reference({ topic: "tdd-when-stuck" })           - Blocker solutions, verification checklist
workflow_reference({ topic: "tdd-anti-patterns" })        - Mock pitfalls, test-only methods
workflow_reference({ topic: "debug-rationalizations" })   - Why investigation-first matters
workflow_reference({ topic: "debug-tracing" })            - Root cause tracing technique
workflow_reference({ topic: "debug-defense-in-depth" })   - Multi-layer validation after fix
workflow_reference({ topic: "debug-condition-waiting" })  - Replace timeouts with conditions
```

### Plan Tracker

The `plan_tracker` tool stores task state in the session and shows progress in the TUI:

```
Tasks: ✓✓→○○ (2/5)  Task 3: Recovery modes
```

```
plan_tracker({ action: "init", tasks: ["Task 1: Setup", "Task 2: Core", ...] })
plan_tracker({ action: "update", index: 0, status: "complete" })
plan_tracker({ action: "status" })
plan_tracker({ action: "clear" })
```

## How Skills and Extensions Work Together

Skills are markdown files the agent reads to learn *what* to do. Extensions are TypeScript modules that *enforce* the discipline in real time.

| Agent Behavior | Skill (teaches) | Extension (enforces) |
|---|---|---|
| Write test before code | `test-driven-development` | TDD monitor warns on violation |
| Investigate before fixing | `systematic-debugging` | Debug monitor warns on fix-without-investigation |
| Run tests before claiming done | `verification-before-completion` | Verification gate blocks commit/push/PR |
| Follow workflow phases | All skills cross-reference each other | Workflow tracker detects phases, prompts at boundaries |
| Dispatch implementation work | `subagent-driven-development` | Subagent extension spawns isolated agents |
| Review before merge | `requesting-code-review` | Subagent dispatches code-reviewer agent |
| Enforce TDD in subagents | — | tdd-guard blocks writes until tests pass |

The orchestrating agent's enforcement is advisory (warnings injected into tool results). Subagent enforcement via tdd-guard is harder: writes are blocked outright, and repeated violations terminate the subprocess.

## Subagent Dispatch

A bundled `subagent` tool lets the orchestrating agent spawn isolated subprocess agents for implementation and review tasks. No external dependencies required.

### Bundled Agents

| Agent | Purpose | Tools | Extensions |
|-------|---------|-------|------------|
| `implementer` | Strict TDD implementation | read, write, edit, bash, lsp | tdd-guard |
| `worker` | General-purpose task execution | read, write, edit, bash, lsp | tdd-guard |
| `code-reviewer` | Production readiness review | read, bash (read-only) | — |
| `spec-reviewer` | Plan/spec compliance check | read, bash (read-only) | — |

Agent definitions live in `agents/*.md` and use YAML frontmatter to declare tools, model, extensions, and a system prompt body.

### Single Agent

```ts
subagent({ agent: "implementer", task: "Implement the retry logic per docs/plans/retry-plan.md Task 3" })
```

### Parallel Tasks

```ts
subagent({
  tasks: [
    { agent: "worker", task: "Fix failing test in auth.test.ts" },
    { agent: "worker", task: "Fix failing test in cache.test.ts" },
  ],
})
```

### Structured Results

Single-agent results include:
- `filesChanged` — list of files written/edited
- `testsRan` — whether any test commands were executed
- `tddViolations` — count of blocked production writes (from tdd-guard)
- `status` — `"completed"` or `"failed"`

### TDD Guard

The `tdd-guard` extension ships alongside the subagent system. When declared in an agent's frontmatter, it:
- **Blocks** writes to non-test files until a *passing* test run is observed
- **Tracks violations** via a temp file (reported in structured results)
- **Hard-exits** after 3 consecutive blocked writes (prevents runaway agents)

### Custom Agents

Add `.md` files to an `agents/` directory at your project root. They override bundled agents of the same name. Frontmatter fields:

```yaml
---
name: my-agent
description: What this agent does
tools: read, write, edit, bash
model: claude-sonnet-4-5
extensions: ../extensions/my-guard.ts
---

System prompt body here.
```

## Compared to Superpowers

Based on [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent, ported to pi as [pi-superpowers](https://github.com/coctostan/pi-superpowers), then extended with active enforcement.

| | [Superpowers](https://github.com/obra/superpowers) | [pi-superpowers](https://github.com/coctostan/pi-superpowers) | **pi-superpowers-plus** |
|---|---|---|---|
| **Platform** | Claude Code | pi | pi |
| **Skills** | 12 workflow skills | Same 12 skills (pi port) | Same 12 skills (leaner TDD & debug) |
| **TDD enforcement** | Skill tells agent the rules | Skill tells agent the rules | Extension *watches* and injects warnings |
| **TDD widget** | — | — | TUI: RED → GREEN → REFACTOR |
| **Debug enforcement** | Manual discipline | Manual discipline | Extension escalates after repeated failures |
| **Verification gating** | — | — | Blocks commit/push/PR until tests pass |
| **Workflow tracking** | — | — | Phase strip, boundary prompts, `/workflow-next` |
| **Subagent dispatch** | — | — | Bundled `subagent` tool + 4 agent definitions |
| **TDD in subagents** | — | — | tdd-guard extension blocks writes until tests pass |
| **Structured results** | — | — | filesChanged, testsRan, tddViolations per agent |
| **Reference content** | Everything in SKILL.md | Everything in SKILL.md | Lean skill + on-demand `workflow_reference` tool |
| **Plan tracker** | — | — | `plan_tracker` tool with TUI progress widget |

## Architecture

```
pi-superpowers-plus/
├── agents/                            # Bundled agent definitions (4 agents)
│   ├── implementer.md                 # Strict TDD implementation agent
│   ├── worker.md                      # General-purpose task agent
│   ├── code-reviewer.md               # Production readiness reviewer
│   └── spec-reviewer.md               # Plan/spec compliance reviewer
├── extensions/
│   ├── plan-tracker.ts                # Task tracking tool + TUI widget
│   ├── tdd-guard.ts                   # TDD enforcement for subagents
│   ├── workflow-monitor.ts            # Extension entry point (event wiring)
│   ├── workflow-monitor/
│   │   ├── tdd-monitor.ts             # TDD phase state machine
│   │   ├── debug-monitor.ts           # Debug mode escalation
│   │   ├── verification-monitor.ts    # Commit/push/PR gating
│   │   ├── workflow-tracker.ts        # Workflow phase tracking + parseSkillName
│   │   ├── workflow-transitions.ts    # Phase boundary prompt definitions
│   │   ├── workflow-handler.ts        # Testable core logic (combines monitors)
│   │   ├── heuristics.ts             # File classification (test vs source)
│   │   ├── test-runner.ts            # Test command/result detection
│   │   ├── investigation.ts          # Investigation signal detection
│   │   ├── git.ts                    # Git branch/SHA detection (branch safety)
│   │   ├── warnings.ts              # Violation warning content
│   │   ├── skip-confirmation.ts      # Phase-skip confirmation logic
│   │   └── reference-tool.ts        # On-demand reference loading
│   └── subagent/
│       ├── index.ts                   # Subagent tool registration + execution
│       └── agents.ts                  # Agent discovery + frontmatter parsing
├── skills/                           # 12 workflow skills (26 markdown files)
│   ├── brainstorming/
│   ├── writing-plans/
│   ├── executing-plans/
│   ├── subagent-driven-development/
│   ├── test-driven-development/
│   ├── systematic-debugging/
│   ├── verification-before-completion/
│   ├── requesting-code-review/
│   ├── receiving-code-review/
│   ├── dispatching-parallel-agents/
│   ├── using-git-worktrees/
│   └── finishing-a-development-branch/
└── tests/                            # 251 tests across 29 files
```

## Development

```bash
npm test                    # Run all tests
npx vitest run tests/extension/workflow-monitor/tdd-monitor.test.ts   # Run one file
```

## Attribution

Skill content adapted from [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent (MIT). This package builds on [pi-superpowers](https://github.com/coctostan/pi-superpowers) with active enforcement extensions, leaner skill files, on-demand reference content, and workflow tracking.

## License

MIT - see [LICENSE](LICENSE) for details.
