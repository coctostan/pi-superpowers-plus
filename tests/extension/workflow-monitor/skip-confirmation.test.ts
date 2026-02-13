import { describe, expect, test } from "vitest";
import {
  WORKFLOW_PHASES,
  type Phase,
  type PhaseStatus,
  type WorkflowTrackerState,
} from "../../../extensions/workflow-monitor/workflow-tracker";
import {
  getUnresolvedPhases,
  getUnresolvedPhasesBefore,
  isPhaseUnresolved,
} from "../../../extensions/workflow-monitor/skip-confirmation";

function createState(overrides: Partial<Record<Phase, PhaseStatus>>): WorkflowTrackerState {
  const phases = Object.fromEntries(
    WORKFLOW_PHASES.map((phase) => [phase, overrides[phase] ?? "complete"])
  ) as Record<Phase, PhaseStatus>;

  const artifacts = Object.fromEntries(WORKFLOW_PHASES.map((phase) => [phase, null])) as Record<
    Phase,
    string | null
  >;

  const prompted = Object.fromEntries(WORKFLOW_PHASES.map((phase) => [phase, false])) as Record<
    Phase,
    boolean
  >;

  return {
    phases,
    currentPhase: null,
    artifacts,
    prompted,
  };
}

describe("skip-confirmation helpers", () => {
  test("treats pending and active as unresolved statuses", () => {
    expect(isPhaseUnresolved("pending")).toBe(true);
    expect(isPhaseUnresolved("active")).toBe(true);
    expect(isPhaseUnresolved("complete")).toBe(false);
    expect(isPhaseUnresolved("skipped")).toBe(false);
  });

  test("returns unresolved phases strictly before target", () => {
    const state = createState({
      plan: "pending",
      execute: "active",
      verify: "pending",
    });

    expect(getUnresolvedPhasesBefore("verify", state)).toEqual(["plan", "execute"]);
  });

  test("excludes skipped phases from unresolved lists", () => {
    const state = createState({
      brainstorm: "skipped",
      plan: "pending",
      execute: "complete",
    });

    expect(getUnresolvedPhases(["brainstorm", "plan", "execute"], state)).toEqual(["plan"]);
  });

  test("filters unresolved phases from required set in input order", () => {
    const state = createState({
      review: "active",
      finish: "pending",
      plan: "complete",
    });

    expect(getUnresolvedPhases(["review", "finish", "plan"], state)).toEqual([
      "review",
      "finish",
    ]);
  });
});
