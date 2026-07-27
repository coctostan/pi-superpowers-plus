import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const WORKFLOW_PHASES = ["brainstorm", "plan", "execute", "verify", "review", "finish"] as const;

export type Phase = (typeof WORKFLOW_PHASES)[number];
export type PhaseStatus = "pending" | "active" | "complete" | "skipped";

export interface WorkflowTrackerState {
  phases: Record<Phase, PhaseStatus>;
  currentPhase: Phase | null;
  artifacts: Record<Phase, string | null>;
  prompted: Record<Phase, boolean>;
}

export type TransitionBoundary =
  | "design_committed"
  | "plan_ready"
  | "execution_complete"
  | "verification_passed"
  | "review_complete";

export function computeBoundaryToPrompt(state: WorkflowTrackerState): TransitionBoundary | null {
  if (state.phases.brainstorm === "complete" && !state.prompted.brainstorm) {
    return "design_committed";
  }
  if (state.phases.plan === "complete" && !state.prompted.plan) {
    return "plan_ready";
  }
  if (state.phases.execute === "complete" && !state.prompted.execute) {
    return "execution_complete";
  }
  if (state.phases.verify === "complete" && !state.prompted.verify) {
    return "verification_passed";
  }
  if (state.phases.review === "complete" && !state.prompted.review) {
    return "review_complete";
  }
  return null;
}

function cloneState(state: WorkflowTrackerState): WorkflowTrackerState {
  return JSON.parse(JSON.stringify(state)) as WorkflowTrackerState;
}

function emptyState(): WorkflowTrackerState {
  const phases = Object.fromEntries(WORKFLOW_PHASES.map((p) => [p, "pending"])) as Record<Phase, PhaseStatus>;

  const artifacts = Object.fromEntries(WORKFLOW_PHASES.map((p) => [p, null])) as Record<Phase, string | null>;

  const prompted = Object.fromEntries(WORKFLOW_PHASES.map((p) => [p, false])) as Record<Phase, boolean>;

  return { phases, currentPhase: null, artifacts, prompted };
}

export const WORKFLOW_TRACKER_ENTRY_TYPE = "workflow_tracker_state";

export function parseSkillName(line: string): string | null {
  const slashMatch = line.match(/^\s*\/skill:([^\s]+)/);
  const xmlMatch = line.match(/<skill\s+name="([^"]+)"/);
  return slashMatch?.[1] ?? xmlMatch?.[1] ?? null;
}

export const SKILL_TO_PHASE: Record<string, Phase> = {
  brainstorming: "brainstorm",
  "writing-plans": "plan",
  "executing-plans": "execute",
  "subagent-driven-development": "execute",
  "verification-before-completion": "verify",
  "requesting-code-review": "review",
  "finishing-a-development-branch": "finish",
};

// Artifact detection is directory-based (not filename-suffix-based):
//   docs/superpowers/specs/  → brainstorm phase (design/spec artifacts)
//   docs/superpowers/plans/   → plan phase (implementation plans)
const SPECS_DIR_RE = /^docs\/superpowers\/specs\//;
const PLANS_DIR_RE = /^docs\/superpowers\/plans\//;

export class WorkflowTracker {
  private state: WorkflowTrackerState = emptyState();

  getState(): WorkflowTrackerState {
    return cloneState(this.state);
  }

  setState(state: WorkflowTrackerState): void {
    this.state = cloneState(state);
  }

  reset(): void {
    this.state = emptyState();
  }

  advanceTo(phase: Phase): boolean {
    const current = this.state.currentPhase;
    const nextIdx = WORKFLOW_PHASES.indexOf(phase);

    if (current) {
      const curIdx = WORKFLOW_PHASES.indexOf(current);
      if (nextIdx <= curIdx) {
        // Backward or same-phase navigation = new task. Reset everything.
        this.reset();
        // Fall through to activate the target phase below.
      } else {
        // Forward advance: auto-complete the current phase.
        if (this.state.phases[current] === "active") {
          this.state.phases[current] = "complete";
        }
      }
    }

    for (const p of WORKFLOW_PHASES) {
      if (p !== phase && this.state.phases[p] === "active") {
        this.state.phases[p] = "complete";
      }
    }

    this.state.currentPhase = phase;
    if (this.state.phases[phase] === "pending") {
      this.state.phases[phase] = "active";
    }

    return true;
  }

  skipPhase(phase: Phase): boolean {
    const status = this.state.phases[phase];
    if (status !== "pending" && status !== "active") return false;
    this.state.phases[phase] = "skipped";
    return true;
  }

  skipPhases(phases: Phase[]): boolean {
    let changed = false;
    for (const p of phases) changed = this.skipPhase(p) || changed;
    return changed;
  }

  completeCurrent(): boolean {
    const phase = this.state.currentPhase;
    if (!phase) return false;
    if (this.state.phases[phase] === "complete") return false;
    this.state.phases[phase] = "complete";
    return true;
  }

  recordArtifact(phase: Phase, path: string): boolean {
    if (this.state.artifacts[phase] === path) return false;
    this.state.artifacts[phase] = path;
    return true;
  }

  markPrompted(phase: Phase): boolean {
    if (this.state.prompted[phase]) return false;
    this.state.prompted[phase] = true;
    return true;
  }

  onInputText(text: string): boolean {
    const lines = text.split(/\r?\n/);
    let changed = false;

    for (const line of lines) {
      const skill = parseSkillName(line);
      if (!skill) continue;
      const phase = SKILL_TO_PHASE[skill] ?? null;

      if (phase && this.advanceTo(phase)) changed = true;
    }

    return changed;
  }

  onSkillFileRead(path: string): boolean {
    const match = path.match(/\/skills\/([^/]+)\/SKILL\.md$/);
    if (!match) return false;
    const phase = SKILL_TO_PHASE[match[1]];
    if (!phase) return false;
    return this.advanceTo(phase);
  }

  onFileWritten(path: string): boolean {
    if (SPECS_DIR_RE.test(path)) {
      const changedArtifact = this.recordArtifact("brainstorm", path);
      const changedPhase = this.advanceTo("brainstorm");
      return changedArtifact || changedPhase;
    }

    if (PLANS_DIR_RE.test(path)) {
      const changedArtifact = this.recordArtifact("plan", path);
      const changedPhase = this.advanceTo("plan");
      return changedArtifact || changedPhase;
    }

    return false;
  }

  onPlanTrackerInit(): boolean {
    return this.advanceTo("execute");
  }

  static reconstructFromBranch(branch: SessionEntry[]): WorkflowTrackerState | null {
    let last: WorkflowTrackerState | null = null;

    for (const entry of branch) {
      if (entry.type !== "custom") continue;
      // biome-ignore lint/suspicious/noExplicitAny: pi SDK session entry type
      if ((entry as any).customType !== WORKFLOW_TRACKER_ENTRY_TYPE) continue;
      // biome-ignore lint/suspicious/noExplicitAny: pi SDK session entry type
      const data = (entry as any).data as WorkflowTrackerState | undefined;
      if (data && typeof data === "object") {
        last = cloneState(data);
      }
    }

    return last;
  }
}
