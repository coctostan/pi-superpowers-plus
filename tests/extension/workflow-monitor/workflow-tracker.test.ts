import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { describe, test, expect, beforeEach } from "vitest";
import { WorkflowTracker, WORKFLOW_PHASES } from "../../../extensions/workflow-monitor/workflow-tracker";

describe("WorkflowTracker", () => {
  let tracker: WorkflowTracker;

  beforeEach(() => {
    tracker = new WorkflowTracker();
  });

  test("starts idle with all phases pending", () => {
    const s = tracker.getState();
    expect(s.currentPhase).toBeNull();
    for (const p of WORKFLOW_PHASES) expect(s.phases[p]).toBe("pending");
  });

  test("advancing to a later phase does NOT mark earlier phases as skipped", () => {
    tracker.advanceTo("execute");
    const s = tracker.getState();
    expect(s.currentPhase).toBe("execute");
    expect(s.phases.brainstorm).toBe("pending");
    expect(s.phases.plan).toBe("pending");
    expect(s.phases.execute).toBe("active");
  });

  test("skipPhase marks a pending phase as skipped", () => {
    const changed = tracker.skipPhase("plan");
    expect(changed).toBe(true);
    expect(tracker.getState().phases.plan).toBe("skipped");
  });

  test("skipPhase marks an active phase as skipped", () => {
    tracker.advanceTo("plan");
    expect(tracker.getState().phases.plan).toBe("active");
    const changed = tracker.skipPhase("plan");
    expect(changed).toBe(true);
    expect(tracker.getState().phases.plan).toBe("skipped");
  });

  test("skipPhase returns false for a complete phase", () => {
    tracker.advanceTo("plan");
    tracker.completeCurrent();
    expect(tracker.getState().phases.plan).toBe("complete");
    const changed = tracker.skipPhase("plan");
    expect(changed).toBe(false);
    expect(tracker.getState().phases.plan).toBe("complete");
  });

  test("skipPhase returns false for an already-skipped phase", () => {
    tracker.skipPhase("plan");
    const changed = tracker.skipPhase("plan");
    expect(changed).toBe(false);
    expect(tracker.getState().phases.plan).toBe("skipped");
  });

  test("skipPhases skips multiple phases in one call", () => {
    tracker.skipPhases(["brainstorm", "plan"]);
    const s = tracker.getState();
    expect(s.phases.brainstorm).toBe("skipped");
    expect(s.phases.plan).toBe("skipped");
  });

  test("advanceTo is forward-only (no-op when going backwards)", () => {
    tracker.advanceTo("plan");
    tracker.advanceTo("brainstorm");
    expect(tracker.getState().currentPhase).toBe("plan");
  });

  test("completeCurrent marks current phase complete and keeps it as current until next advance", () => {
    tracker.advanceTo("plan");
    tracker.completeCurrent();
    const s = tracker.getState();
    expect(s.phases.plan).toBe("complete");
    expect(s.currentPhase).toBe("plan");
  });

  test("records artifacts per phase", () => {
    tracker.recordArtifact("brainstorm", "docs/plans/2026-02-10-x-design.md");
    expect(tracker.getState().artifacts.brainstorm).toBe("docs/plans/2026-02-10-x-design.md");
  });
});

function custom(data: any): SessionEntry {
  return {
    type: "custom",
    id: "x",
    parentId: null,
    timestamp: Date.now(),
    customType: "workflow_tracker_state",
    data,
  } as any;
}

describe("WorkflowTracker detection helpers", () => {
  test("detects /skill:brainstorming and advances to brainstorm", () => {
    const tracker = new WorkflowTracker();
    const changed = tracker.onInputText("/skill:brainstorming");
    expect(changed).toBe(true);
    expect(tracker.getState().currentPhase).toBe("brainstorm");
  });

  test("detects /skill token with trailing text at start of a later line", () => {
    const tracker = new WorkflowTracker();
    const changed = tracker.onInputText("status update\n/skill:writing-plans draft initial breakdown");
    expect(changed).toBe(true);
    expect(tracker.getState().currentPhase).toBe("plan");
  });

  test("detects /skill token on later indented line in multi-line input", () => {
    const tracker = new WorkflowTracker();
    const changed = tracker.onInputText("first line\n  /skill:verification-before-completion run checks");
    expect(changed).toBe(true);
    expect(tracker.getState().currentPhase).toBe("verify");
  });

  test("continues scanning when first recognized /skill line is a no-op and later line advances", () => {
    const tracker = new WorkflowTracker();
    tracker.advanceTo("plan");

    const changed = tracker.onInputText(
      "/skill:brainstorming\n/skill:verification-before-completion run checks"
    );

    expect(changed).toBe(true);
    expect(tracker.getState().currentPhase).toBe("verify");
  });

  test("ignores unknown /skill line and advances on later valid /skill line", () => {
    const tracker = new WorkflowTracker();

    const changed = tracker.onInputText("/skill:not-a-real-skill\n/skill:writing-plans");

    expect(changed).toBe(true);
    expect(tracker.getState().currentPhase).toBe("plan");
  });

  test("does not detect /skill token when not at line start", () => {
    const tracker = new WorkflowTracker();
    const changed = tracker.onInputText("please run /skill:writing-plans draft initial breakdown");
    expect(changed).toBe(false);
    expect(tracker.getState().currentPhase).toBeNull();
  });

  test("detects writing a design doc artifact and advances to brainstorm", () => {
    const tracker = new WorkflowTracker();
    tracker.onFileWritten("docs/plans/2026-02-10-foo-design.md");
    const s = tracker.getState();
    expect(s.currentPhase).toBe("brainstorm");
    expect(s.artifacts.brainstorm).toBe("docs/plans/2026-02-10-foo-design.md");
  });

  test("detects writing an implementation plan artifact and advances to plan", () => {
    const tracker = new WorkflowTracker();
    tracker.onFileWritten("docs/plans/2026-02-11-foo-implementation.md");
    const s = tracker.getState();
    expect(s.currentPhase).toBe("plan");
    expect(s.artifacts.plan).toBe("docs/plans/2026-02-11-foo-implementation.md");
  });

  test("detects plan_tracker init and advances to execute", () => {
    const tracker = new WorkflowTracker();
    tracker.onPlanTrackerInit();
    expect(tracker.getState().currentPhase).toBe("execute");
  });

  test("reconstructFromBranch returns last saved state", () => {
    const tracker = new WorkflowTracker();
    tracker.advanceTo("plan");
    const s1 = tracker.getState();

    tracker.advanceTo("execute");
    const s2 = tracker.getState();

    const reconstructed = WorkflowTracker.reconstructFromBranch([
      custom(s1),
      { type: "message" } as any,
      custom(s2),
    ] as any);

    expect(reconstructed?.currentPhase).toBe("execute");
  });
});
