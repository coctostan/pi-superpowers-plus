import { describe, test, expect, vi } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";
import {
  WORKFLOW_TRACKER_ENTRY_TYPE,
  WORKFLOW_PHASES,
  type Phase,
  type PhaseStatus,
  type WorkflowTrackerState,
} from "../../../extensions/workflow-monitor/workflow-tracker";

type Handler = (event: any, ctx: any) => any;

function createFakePi() {
  const handlers = new Map<string, Handler[]>();
  const appendedEntries: any[] = [];

  return {
    handlers,
    appendedEntries,
    api: {
      on(event: string, handler: Handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      registerTool() {},
      registerCommand() {},
      appendEntry(customType: string, data: any) {
        appendedEntries.push({ customType, data });
      },
    },
  };
}

function getSingleHandler(handlers: Map<string, Handler[]>, event: string): Handler {
  const list = handlers.get(event) ?? [];
  expect(list.length).toBeGreaterThan(0);
  return list[0]!;
}

function createWorkflowState(
  overrides: Partial<Record<Phase, PhaseStatus>>,
  currentPhase: Phase | null = null
): WorkflowTrackerState {
  const phases = Object.fromEntries(
    WORKFLOW_PHASES.map((p) => [p, overrides[p] ?? "pending"])
  ) as Record<Phase, PhaseStatus>;
  const artifacts = Object.fromEntries(
    WORKFLOW_PHASES.map((p) => [p, null])
  ) as Record<Phase, string | null>;
  const prompted = Object.fromEntries(
    WORKFLOW_PHASES.map((p) => [p, false])
  ) as Record<Phase, boolean>;
  return { phases, currentPhase, artifacts, prompted };
}

function setupWithState(state: WorkflowTrackerState) {
  const fake = createFakePi();
  workflowMonitorExtension(fake.api as any);

  const onSessionSwitch = getSingleHandler(fake.handlers, "session_switch");
  const onInput = getSingleHandler(fake.handlers, "input");

  return { fake, onSessionSwitch, onInput };
}

describe("skip-confirmation gating on /skill transitions", () => {
  test("non-interactive bypasses gate (no prompt shown)", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm")
    );

    const ctx = {
      hasUI: false,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm"),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn(),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    // Jump from brainstorm straight to execute, skipping plan - no UI so no gate
    await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  test("no gate when zero unresolved phases before target", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState({ brainstorm: "complete", plan: "complete" }, "plan")
    );

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "complete", plan: "complete" }, "plan"),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn(),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    // All prior phases complete, going to execute - no gate needed
    await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  test("single unresolved + skip: skips phase and allows transition", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm")
    );

    const editorTexts: string[] = [];
    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm"),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockResolvedValue("skip"),
        setEditorText: (text: string) => editorTexts.push(text),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    // Should have prompted
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);

    // Plan should be skipped in persisted state
    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.plan).toBe("skipped");
    // Should have advanced to execute
    expect(latest.currentPhase).toBe("execute");
  });

  test("single unresolved + do now: blocks transition, sets editor to missing phase skill", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm")
    );

    const editorTexts: string[] = [];
    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm"),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockResolvedValue("do_now"),
        setEditorText: (text: string) => editorTexts.push(text),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);

    // Should block by returning { blocked: true }
    expect(result).toEqual({ blocked: true });

    // Editor should be set to the missing phase's skill
    expect(editorTexts.at(-1)).toBe("/skill:writing-plans");

    // State should NOT advance to execute
    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest?.currentPhase).not.toBe("execute");
  });

  test("single unresolved + cancel: blocks transition", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm")
    );

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "complete", plan: "pending" }, "brainstorm"),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockResolvedValue("cancel"),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ blocked: true });
    // Editor should not be touched
    expect(ctx.ui.setEditorText).not.toHaveBeenCalled();
  });

  test("multi unresolved + skip all: skips all and allows transition", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState(
        { brainstorm: "pending", plan: "pending", execute: "pending" },
        null
      )
    );

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState(
              { brainstorm: "pending", plan: "pending", execute: "pending" },
              null
            ),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockResolvedValue("skip_all"),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);

    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.brainstorm).toBe("skipped");
    expect(latest.phases.plan).toBe("skipped");
    expect(latest.currentPhase).toBe("execute");
  });

  test("multi unresolved + cancel: blocks transition", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState(
        { brainstorm: "pending", plan: "pending", execute: "pending" },
        null
      )
    );

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState(
              { brainstorm: "pending", plan: "pending", execute: "pending" },
              null
            ),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockResolvedValue("cancel"),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ blocked: true });
  });

  test("multi unresolved + review one-by-one: prompts each, skip individual", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState(
        { brainstorm: "pending", plan: "pending", execute: "pending" },
        null
      )
    );

    // First select: review_individually, then skip brainstorm, then skip plan
    const selectResponses = ["review_individually", "skip", "skip"];
    let selectIdx = 0;

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState(
              { brainstorm: "pending", plan: "pending", execute: "pending" },
              null
            ),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockImplementation(async () => selectResponses[selectIdx++]),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    // Summary prompt + 2 individual prompts
    expect(ctx.ui.select).toHaveBeenCalledTimes(3);

    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.brainstorm).toBe("skipped");
    expect(latest.phases.plan).toBe("skipped");
    expect(latest.currentPhase).toBe("execute");
  });

  test("multi unresolved + review one-by-one + do_now on first: blocks transition", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState(
        { brainstorm: "pending", plan: "pending", execute: "pending" },
        null
      )
    );

    const editorTexts: string[] = [];
    const selectResponses = ["review_individually", "do_now"];
    let selectIdx = 0;

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState(
              { brainstorm: "pending", plan: "pending", execute: "pending" },
              null
            ),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockImplementation(async () => selectResponses[selectIdx++]),
        setEditorText: (text: string) => editorTexts.push(text),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput({ source: "user", input: "/skill:executing-plans" }, ctx);

    // Summary prompt + 1 individual prompt (stops at do_now)
    expect(ctx.ui.select).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ blocked: true });
    expect(editorTexts.at(-1)).toBe("/skill:brainstorming");
  });

  test("extension-sourced input events bypass gate", async () => {
    const { fake, onSessionSwitch, onInput } = setupWithState(
      createWorkflowState({ brainstorm: "pending", plan: "pending" }, null)
    );

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "pending", plan: "pending" }, null),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn(),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onInput({ source: "extension", input: "/skill:executing-plans" }, ctx);

    // Extension inputs are skipped entirely (early return)
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });
});

describe("multiline /skill input: gate applies to furthest target phase", () => {
  test("input with earlier skill on first line and farther skill on later line gates to farther phase", async () => {
    const state = createWorkflowState({ brainstorm: "complete" }, "brainstorm");
    const { fake, onSessionSwitch, onInput } = setupWithState(state);

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "complete" }, "brainstorm"),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockResolvedValue("skip_all"),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onInput(
      {
        source: "user",
        input: "/skill:writing-plans\nsome text\n/skill:verification-before-completion",
      },
      ctx
    );

    // Gate should have fired because plan and execute are unresolved before verify
    expect(ctx.ui.select).toHaveBeenCalled();

    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.plan).toBe("skipped");
    expect(latest.phases.execute).toBe("skipped");
    expect(latest.currentPhase).toBe("verify");
  });

  test("single-line earlier skill does not silently bypass gate for later phases", async () => {
    const state = createWorkflowState({ brainstorm: "complete" }, "brainstorm");
    const { fake, onSessionSwitch, onInput } = setupWithState(state);

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "complete" }, "brainstorm"),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn(),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onInput({ source: "user", input: "/skill:writing-plans" }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  test("multiline with unknown skills returns null target (no gate)", async () => {
    const state = createWorkflowState({ brainstorm: "pending" }, null);
    const { fake, onSessionSwitch, onInput } = setupWithState(state);

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({ brainstorm: "pending" }, null),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn(),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onInput({ source: "user", input: "/skill:unknown-thing\n/skill:also-unknown" }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  test("multiline input blocks when farther phase has unresolved predecessors", async () => {
    const state = createWorkflowState({}, null);
    const { fake, onSessionSwitch, onInput } = setupWithState(state);

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: createWorkflowState({}, null),
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockResolvedValue("cancel"),
        setEditorText: vi.fn(),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    const result = await onInput(
      {
        source: "user",
        input: "/skill:brainstorming\n/skill:executing-plans",
      },
      ctx
    );

    expect(ctx.ui.select).toHaveBeenCalled();
    expect(result).toEqual({ blocked: true });
  });
});
