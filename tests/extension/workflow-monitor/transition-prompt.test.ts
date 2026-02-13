import { describe, test, expect } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";
import {
  WORKFLOW_TRACKER_ENTRY_TYPE,
  WorkflowTracker,
  computeBoundaryToPrompt,
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

describe("boundary prompting", () => {
  test("prompts after brainstorm complete", () => {
    const t = new WorkflowTracker();
    t.advanceTo("brainstorm");
    t.completeCurrent();
    const boundary = computeBoundaryToPrompt(t.getState());
    expect(boundary).toBe("design_committed");
  });

  test("does not auto-complete active phase on generic agent_end", async () => {
    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onInput = getSingleHandler(fake.handlers, "input");
    const onAgentEnd = getSingleHandler(fake.handlers, "agent_end");

    let agentEndSelectCalls = 0;
    let inAgentEnd = false;
    const ctx = {
      hasUI: true,
      sessionManager: { getBranch: () => [] },
      ui: {
        setWidget: () => {},
        select: async (_title: string, options: any[]) => {
          if (inAgentEnd) {
            agentEndSelectCalls += 1;
            return "discuss";
          }
          // Gate prompt: skip single or skip_all for multi
          const hasSkipAll = options?.some?.((o: any) => o.value === "skip_all");
          return hasSkipAll ? "skip_all" : "skip";
        },
        setEditorText: () => {},
        notify: () => {},
      },
    };

    await onInput({ source: "user", input: "/skill:writing-plans" }, ctx);
    inAgentEnd = true;
    await onAgentEnd({}, ctx);

    expect(agentEndSelectCalls).toBe(0);
  });

  test("prompts once for completed boundary and does not re-prompt", async () => {
    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onSessionSwitch = getSingleHandler(fake.handlers, "session_switch");
    const onAgentEnd = getSingleHandler(fake.handlers, "agent_end");

    let agentEndSelectCalls = 0;
    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: {
              phases: {
                brainstorm: "skipped",
                plan: "complete",
                execute: "active",
                verify: "pending",
                review: "pending",
                finish: "pending",
              },
              currentPhase: "execute",
              artifacts: { brainstorm: null, plan: null, execute: null, verify: null, review: null, finish: null },
              prompted: { brainstorm: false, plan: false, execute: false, verify: false, review: false, finish: false },
            },
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: async () => {
          agentEndSelectCalls += 1;
          return "discuss";
        },
        setEditorText: () => {},
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onAgentEnd({}, ctx);
    await onAgentEnd({}, ctx);

    expect(agentEndSelectCalls).toBe(1);
  });

  test("skip marks next phase skipped and advances beyond it", async () => {
    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onSessionSwitch = getSingleHandler(fake.handlers, "session_switch");
    const onAgentEnd = getSingleHandler(fake.handlers, "agent_end");

    const editorTexts: string[] = [];
    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: {
              phases: {
                brainstorm: "complete",
                plan: "pending",
                execute: "active",
                verify: "pending",
                review: "pending",
                finish: "pending",
              },
              currentPhase: "execute",
              artifacts: { brainstorm: null, plan: null, execute: null, verify: null, review: null, finish: null },
              prompted: { brainstorm: false, plan: false, execute: false, verify: false, review: false, finish: false },
            },
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: async () => "skip",
        setEditorText: (text: string) => editorTexts.push(text),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onAgentEnd({}, ctx);

    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.plan).toBe("skipped");
    expect(latest.currentPhase).toBe("execute");
    expect(editorTexts.at(-1)).toBe("/skill:executing-plans");
  });

  test("skip on terminal next phase marks it skipped without advancing into it", async () => {
    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onSessionSwitch = getSingleHandler(fake.handlers, "session_switch");
    const onAgentEnd = getSingleHandler(fake.handlers, "agent_end");

    const editorTexts: string[] = [];
    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: {
              phases: {
                brainstorm: "complete",
                plan: "complete",
                execute: "complete",
                verify: "complete",
                review: "complete",
                finish: "pending",
              },
              currentPhase: "review",
              artifacts: {
                brainstorm: null,
                plan: null,
                execute: null,
                verify: null,
                review: null,
                finish: null,
              },
              prompted: {
                brainstorm: true,
                plan: true,
                execute: true,
                verify: true,
                review: false,
                finish: false,
              },
            },
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: async () => "skip",
        setEditorText: (text: string) => editorTexts.push(text),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onAgentEnd({}, ctx);

    const latest = fake.appendedEntries.at(-1)?.data;
    expect(latest.phases.finish).toBe("skipped");
    expect(latest.currentPhase).toBe("review");
    expect(editorTexts).toHaveLength(0);
  });

  test("verification boundary is prompted only after passing verification signal", async () => {
    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onInput = getSingleHandler(fake.handlers, "input");
    const onAgentEnd = getSingleHandler(fake.handlers, "agent_end");
    const onToolResult = getSingleHandler(fake.handlers, "tool_result");

    let agentEndSelectCalls = 0;
    // Track whether we're in agent_end context to distinguish gate prompts from boundary prompts
    let inAgentEnd = false;
    const ctx = {
      hasUI: true,
      sessionManager: { getBranch: () => [] },
      ui: {
        setWidget: () => {},
        select: async (_title: string, options: any[]) => {
          if (inAgentEnd) {
            agentEndSelectCalls += 1;
            return "discuss";
          }
          const hasSkipAll = options?.some?.((o: any) => o.value === "skip_all");
          return hasSkipAll ? "skip_all" : "skip";
        },
        setEditorText: () => {},
        notify: () => {},
      },
    };

    await onInput({ source: "user", input: "/skill:verification-before-completion" }, ctx);

    inAgentEnd = true;
    await onAgentEnd({}, ctx);
    inAgentEnd = false;
    expect(agentEndSelectCalls).toBe(0);

    await onToolResult(
      {
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: "167 passed" }],
        details: { exitCode: 0 },
      },
      ctx
    );

    inAgentEnd = true;
    await onAgentEnd({}, ctx);
    expect(agentEndSelectCalls).toBe(1);
  });

  test("finish transition pre-fills docs + learnings reminder", async () => {
    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onSessionSwitch = getSingleHandler(fake.handlers, "session_switch");
    const onAgentEnd = getSingleHandler(fake.handlers, "agent_end");

    const editorTexts: string[] = [];

    const ctx = {
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: WORKFLOW_TRACKER_ENTRY_TYPE,
            data: {
              phases: {
                brainstorm: "complete",
                plan: "complete",
                execute: "complete",
                verify: "complete",
                review: "complete",
                finish: "active",
              },
              currentPhase: "finish",
              artifacts: {
                brainstorm: null,
                plan: null,
                execute: null,
                verify: null,
                review: null,
                finish: null,
              },
              prompted: {
                brainstorm: true,
                plan: true,
                execute: true,
                verify: true,
                review: false,
                finish: false,
              },
            },
          },
        ],
      },
      ui: {
        setWidget: () => {},
        select: async () => "next",
        setEditorText: (text: string) => editorTexts.push(text),
        notify: () => {},
      },
    };

    await onSessionSwitch({}, ctx);
    await onAgentEnd({}, ctx);

    const text = editorTexts.at(-1) ?? "";
    expect(text).toContain("Before finishing:");
    expect(text).toContain("documentation updates");
    expect(text).toContain("What was learned");
    expect(text).toContain("/skill:finishing-a-development-branch");
  });
});
