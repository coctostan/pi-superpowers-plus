import {
  WORKFLOW_PHASES,
  type Phase,
  type PhaseStatus,
  type WorkflowTrackerState,
} from "./workflow-tracker";

export function isPhaseUnresolved(status: PhaseStatus): boolean {
  return status === "pending" || status === "active";
}

export function getUnresolvedPhasesBefore(target: Phase, state: WorkflowTrackerState): Phase[] {
  const targetIndex = WORKFLOW_PHASES.indexOf(target);
  if (targetIndex === -1) {
    return [];
  }

  const phasesBefore = WORKFLOW_PHASES.slice(0, targetIndex);
  return getUnresolvedPhases(phasesBefore, state);
}

export function getUnresolvedPhases(phases: Phase[], state: WorkflowTrackerState): Phase[] {
  return phases.filter((phase) => isPhaseUnresolved(state.phases[phase]));
}
