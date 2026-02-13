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

function getHandlers(handlers: Map<string, Handler[]>, event: string): Handler[] {
  return handlers.get(event) ?? [];
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

function createCtx(
  state: WorkflowTrackerState,
  hasUI: boolean,
  selectResponses: string[] = []
) {
  let selectIdx = 0;
  const editorTexts: string[] = [];
  return {
    editorTexts,
    ctx: {
      hasUI,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: state,
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: vi.fn().mockImplementation(async () => selectResponses[selectIdx++]),
        setEditorText: (text: string) => editorTexts.push(text),
        notify: () => {},
      },
    },
  };
}

async function setupExtension(state: WorkflowTrackerState) {
  const fake = createFakePi();
  workflowMonitorExtension(fake.api as any);

  const onSessionSwitch = getSingleHandler(fake.handlers, "session_switch");
  const onToolCall = getSingleHandler(fake.handlers, "tool_call");
  const onToolResult = getSingleHandler(fake.handlers, "tool_result");

  return { fake, onSessionSwitch, onToolCall, onToolResult };
}

describe("completion-action gating on bash commands", () => {
  test("interactive commit with unresolved verify -> Do now blocks + editor set to /skill:verification-before-completion", async () => {
    const state = createWorkflowState(
      {
        brainstorm: "complete",
        plan: "complete",
        execute: "complete",
        verify: "pending",
        review: "pending",
        finish: "pending",
      },
      "execute"
    );
    const { fake, onSessionSwitch, onToolCall } = await setupExtension(state);
    const { ctx, editorTexts } = createCtx(state, true, ["do_now"]);

    await onSessionSwitch({}, ctx);

    const result = await onToolCall(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git commit -m 'feat: done'" },
      },
      ctx
    );

    expect(ctx.ui.select).toHaveBeenCalled();
    expect(result).toEqual({ blocked: true });
    // Editor should be prefilled with verification skill
    expect(editorTexts.length).toBeGreaterThan(0);
    expect(editorTexts.at(-1)).toBe("/skill:verification-before-completion");
  });

  test("interactive commit with unresolved verify -> Skip allows command, marks verify skipped, and records waiver", async () => {
    const state = createWorkflowState(
      {
        brainstorm: "complete",
        plan: "complete",
        execute: "complete",
        verify: "pending",
        review: "pending",
        finish: "pending",
      },
      "execute"
    );
    const { fake, onSessionSwitch, onToolCall, onToolResult } = await setupExtension(state);
    const { ctx } = createCtx(state, true, ["skip"]);

    await onSessionSwitch({}, ctx);

    const toolCallResult = await onToolCall(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git commit -m 'feat: done'" },
      },
      ctx
    );

    // Should NOT block
    expect(toolCallResult?.blocked).not.toBe(true);

    // Verify should be marked skipped
    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.verify).toBe("skipped");

    // The verification warning should NOT be injected for this same call
    // (waiver recorded). Let's check tool_result doesn't inject verification warning.
    const resultEvent = {
      toolCallId: "tc1",
      toolName: "bash",
      input: { command: "git commit -m 'feat: done'" },
      content: [{ type: "text", text: "commit created" }],
      details: { exitCode: 0 },
    };
    const toolResultOutput = await onToolResult(resultEvent, ctx);

    // Should NOT contain verification violation warning
    if (toolResultOutput?.content) {
      const allText = toolResultOutput.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      expect(allText).not.toContain("commit-without-verification");
      expect(allText).not.toContain("without running verification");
    }
  });

  test("interactive push with unresolved verify+review -> Skip all allows and marks both skipped", async () => {
    const state = createWorkflowState(
      {
        brainstorm: "complete",
        plan: "complete",
        execute: "complete",
        verify: "pending",
        review: "pending",
        finish: "pending",
      },
      "execute"
    );
    const { fake, onSessionSwitch, onToolCall } = await setupExtension(state);
    const { ctx } = createCtx(state, true, ["skip_all"]);

    await onSessionSwitch({}, ctx);

    const result = await onToolCall(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git push origin main" },
      },
      ctx
    );

    expect(result?.blocked).not.toBe(true);

    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.verify).toBe("skipped");
    expect(latest.phases.review).toBe("skipped");
  });

  test("interactive gh pr create with unresolved verify+review -> cancel blocks command", async () => {
    const state = createWorkflowState(
      {
        brainstorm: "complete",
        plan: "complete",
        execute: "complete",
        verify: "pending",
        review: "pending",
        finish: "pending",
      },
      "execute"
    );
    const { fake, onSessionSwitch, onToolCall } = await setupExtension(state);
    const { ctx } = createCtx(state, true, ["cancel"]);

    await onSessionSwitch({}, ctx);

    const result = await onToolCall(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "gh pr create --title 'feat'" },
      },
      ctx
    );

    expect(result).toEqual({ blocked: true });
  });

  test("non-interactive commit path does not prompt and preserves warning behavior", async () => {
    const state = createWorkflowState(
      {
        brainstorm: "complete",
        plan: "complete",
        execute: "complete",
        verify: "pending",
        review: "pending",
        finish: "pending",
      },
      "execute"
    );
    const { fake, onSessionSwitch, onToolCall, onToolResult } = await setupExtension(state);
    const { ctx } = createCtx(state, false);

    await onSessionSwitch({}, ctx);

    const toolCallResult = await onToolCall(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git commit -m 'feat: stuff'" },
      },
      ctx
    );

    // Should NOT prompt (no UI)
    expect(ctx.ui.select).not.toHaveBeenCalled();
    // Should NOT block
    expect(toolCallResult?.blocked).not.toBe(true);

    // Verification warning should still be injected via tool_result path
    const resultEvent = {
      toolCallId: "tc1",
      toolName: "bash",
      input: { command: "git commit -m 'feat: stuff'" },
      content: [{ type: "text", text: "commit created" }],
      details: { exitCode: 0 },
    };
    const toolResultOutput = await onToolResult(resultEvent, ctx);

    // Should contain verification warning
    expect(toolResultOutput?.content).toBeDefined();
    const allText = toolResultOutput.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    expect(allText).toContain("verification");
  });

  test("non-matching bash commands are not gated", async () => {
    const state = createWorkflowState(
      {
        brainstorm: "complete",
        plan: "complete",
        execute: "complete",
        verify: "pending",
      },
      "execute"
    );
    const { onSessionSwitch, onToolCall } = await setupExtension(state);
    const { ctx } = createCtx(state, true);

    await onSessionSwitch({}, ctx);

    const result = await onToolCall(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "ls -la" },
      },
      ctx
    );

    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(result?.blocked).not.toBe(true);
  });

  test("commit with all phases resolved does not gate", async () => {
    const state = createWorkflowState(
      {
        brainstorm: "complete",
        plan: "complete",
        execute: "complete",
        verify: "complete",
        review: "complete",
        finish: "pending",
      },
      "verify"
    );
    const { onSessionSwitch, onToolCall } = await setupExtension(state);
    const { ctx } = createCtx(state, true);

    await onSessionSwitch({}, ctx);

    const result = await onToolCall(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git commit -m 'final'" },
      },
      ctx
    );

    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(result?.blocked).not.toBe(true);
  });
});
