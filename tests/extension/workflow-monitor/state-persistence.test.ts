import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test, vi } from "vitest";
import * as logging from "../../../extensions/logging";
import workflowMonitorExtension, { getStateFilePath, reconstructState } from "../../../extensions/workflow-monitor";
import { DebugMonitor } from "../../../extensions/workflow-monitor/debug-monitor";
import {
  createWorkflowHandler,
  DEBUG_DEFAULTS,
  TDD_DEFAULTS,
  VERIFICATION_DEFAULTS,
  type SuperpowersStateSnapshot,
} from "../../../extensions/workflow-monitor/workflow-handler";
import { VerificationMonitor } from "../../../extensions/workflow-monitor/verification-monitor";
import { WORKFLOW_TRACKER_ENTRY_TYPE, WorkflowTracker } from "../../../extensions/workflow-monitor/workflow-tracker";
import { createFakePi, getSingleHandler, withTempCwd } from "./test-helpers";

describe("DebugMonitor state persistence", () => {
  test("getState returns serializable monitor state", () => {
    const monitor = new DebugMonitor();

    monitor.onTestFailed();
    monitor.onInvestigation();
    monitor.onSourceWritten("src/foo.ts");
    monitor.onTestFailed(); // fixAttempts = 1
    monitor.onInvestigation();

    expect(monitor.getState()).toEqual({
      active: true,
      investigated: true,
      fixAttempts: 1,
    });
  });

  test("setState restores monitor state fields", () => {
    const monitor = new DebugMonitor();

    monitor.setState({ active: true, investigated: false, fixAttempts: 3 });

    expect(monitor.isActive()).toBe(true);
    expect(monitor.hasInvestigated()).toBe(false);
    expect(monitor.getFixAttempts()).toBe(3);
  });

  test("setState does not persist sourceWrittenSinceLastTest", () => {
    const monitor = new DebugMonitor();

    monitor.setState({ active: true, investigated: false, fixAttempts: 2 });
    monitor.onTestFailed();

    expect(monitor.getFixAttempts()).toBe(2);
  });
});

describe("VerificationMonitor state persistence", () => {
  test("getState returns serializable monitor state", () => {
    const monitor = new VerificationMonitor();

    monitor.recordVerification();
    monitor.recordVerificationWaiver();

    expect(monitor.getState()).toEqual({
      verified: true,
      verificationWaived: true,
    });
  });

  test("setState restores monitor state fields", () => {
    const monitor = new VerificationMonitor();

    monitor.setState({ verified: false, verificationWaived: true });

    expect(monitor.hasRecentVerification()).toBe(false);
    expect(monitor.checkCommitGate("git commit -m 'x'")).toBeNull();
  });
});

describe("WorkflowHandler aggregated state persistence", () => {
  test("getFullState aggregates workflow, tdd, debug, and verification state", () => {
    const handler = createWorkflowHandler();

    handler.handleInputText("/skill:writing-plans");
    handler.handleBashResult("npx vitest run", "FAIL", 1);
    handler.handleBashResult("npx vitest run", "FAIL", 1);
    handler.handleReadOrInvestigation("read", "extensions/workflow-monitor/workflow-handler.ts");
    handler.handleToolCall("edit", { path: "src/foo.ts" });
    handler.handleBashResult("npx vitest run", "FAIL", 1);
    handler.handleReadOrInvestigation("read", "extensions/workflow-monitor/workflow-handler.ts");
    handler.restoreTddState("red", ["tests/foo.test.ts"], ["src/foo.ts"], false);
    handler.recordVerificationWaiver();

    expect(handler.getFullState()).toEqual({
      workflow: handler.getWorkflowState(),
      tdd: {
        phase: "red",
        testFiles: ["tests/foo.test.ts"],
        sourceFiles: ["src/foo.ts"],
        redVerificationPending: false,
      },
      debug: {
        active: true,
        investigated: true,
        fixAttempts: 1,
      },
      verification: {
        verified: false,
        verificationWaived: true,
      },
    });
  });

  test("setFullState distributes state to all subsystems", () => {
    const handler = createWorkflowHandler();
    const snapshot: SuperpowersStateSnapshot = {
      workflow: {
        phases: {
          brainstorm: "complete",
          plan: "active",
          execute: "pending",
          verify: "pending",
          review: "pending",
          finish: "pending",
        },
        currentPhase: "plan",
        artifacts: {
          brainstorm: "docs/superpowers/specs/2026-02-15-feature-design.md",
          plan: null,
          execute: null,
          verify: null,
          review: null,
          finish: null,
        },
        prompted: {
          brainstorm: true,
          plan: false,
          execute: false,
          verify: false,
          review: false,
          finish: false,
        },
      },
      tdd: {
        phase: "green",
        testFiles: ["tests/a.test.ts"],
        sourceFiles: ["src/a.ts"],
        redVerificationPending: false,
      },
      debug: {
        active: true,
        investigated: false,
        fixAttempts: 2,
      },
      verification: {
        verified: false,
        verificationWaived: true,
      },
    };

    handler.setFullState(snapshot);

    expect(handler.getFullState()).toEqual(snapshot);
    expect(handler.getTddPhase()).toBe("green");
    expect(handler.isDebugActive()).toBe(true);
    expect(handler.getDebugFixAttempts()).toBe(2);
    expect(handler.checkCommitGate("git commit -m 'x'")).toBeNull();
  });

  test("round-trips full state snapshot", () => {
    const source = createWorkflowHandler();

    source.handleInputText("/skill:writing-plans");
    source.restoreTddState("refactor", ["tests/r.test.ts"], ["src/r.ts"], false);
    source.handleBashResult("npx vitest run", "FAIL", 1);
    source.handleBashResult("npx vitest run", "FAIL", 1);
    source.recordVerificationWaiver();

    const snapshot = source.getFullState();

    const target = createWorkflowHandler();
    target.setFullState(snapshot);

    expect(target.getFullState()).toEqual(snapshot);
  });

  test("setFullState tolerates missing sections defensively", () => {
    const handler = createWorkflowHandler();

    expect(() => handler.setFullState({} as SuperpowersStateSnapshot)).not.toThrow();
  });

  test("setFullState merges partial nested fields with defaults", () => {
    const handler = createWorkflowHandler();

    expect(() =>
      handler.setFullState({
        tdd: {
          phase: "red",
        },
        debug: {
          active: true,
        },
        verification: {
          verificationWaived: true,
        },
      }),
    ).not.toThrow();

    expect(handler.getFullState()).toMatchObject({
      tdd: {
        phase: "red",
        testFiles: [],
        sourceFiles: [],
        redVerificationPending: false,
      },
      debug: {
        active: true,
        investigated: false,
        fixAttempts: 0,
      },
      verification: {
        verified: false,
        verificationWaived: true,
      },
    });
  });

  test("handleSkillFileRead delegates to workflow tracker", () => {
    const handler = createWorkflowHandler();

    const changed = handler.handleSkillFileRead("/home/pi/workspace/pi-superpowers-plus/skills/writing-plans/SKILL.md");

    expect(changed).toBe(true);
    expect(handler.getWorkflowState()?.currentPhase).toBe("plan");
  });

  test("resetState restores all subsystems to defaults", () => {
    const handler = createWorkflowHandler();

    handler.handleInputText("/skill:writing-plans");
    handler.restoreTddState("green", ["tests/x.test.ts"], ["src/x.ts"], false);
    handler.setFullState({
      workflow: handler.getWorkflowState()!,
      tdd: {
        phase: "green",
        testFiles: ["tests/x.test.ts"],
        sourceFiles: ["src/x.ts"],
        redVerificationPending: false,
      },
      debug: { active: true, investigated: true, fixAttempts: 3 },
      verification: { verified: true, verificationWaived: true },
    });

    handler.resetState();

    expect(handler.getFullState()).toEqual({
      workflow: new WorkflowTracker().getState(),
      tdd: {
        phase: "idle",
        testFiles: [],
        sourceFiles: [],
        redVerificationPending: false,
      },
      debug: {
        active: false,
        investigated: false,
        fixAttempts: 0,
      },
      verification: {
        verified: false,
        verificationWaived: false,
      },
    });
  });
});

describe("file-based state persistence", () => {
  test("getStateFilePath returns .pi/superpowers-state.json in cwd", () => {
    withTempCwd();

    const result = getStateFilePath();
    expect(result).toMatch(/\.pi\/superpowers-state\.json$/);
  });

  test("reconstructState reads from file when it exists", () => {
    const tempDir = withTempCwd();
    const handler = createWorkflowHandler();
    const snapshot: SuperpowersStateSnapshot = {
      workflow: {
        phases: {
          brainstorm: "complete",
          plan: "active",
          execute: "pending",
          verify: "pending",
          review: "pending",
          finish: "pending",
        },
        currentPhase: "plan",
        artifacts: {
          brainstorm: "docs/superpowers/specs/file-design.md",
          plan: null,
          execute: null,
          verify: null,
          review: null,
          finish: null,
        },
        prompted: {
          brainstorm: true,
          plan: false,
          execute: false,
          verify: false,
          review: false,
          finish: false,
        },
      },
      tdd: {
        phase: "green",
        testFiles: ["tests/file.test.ts"],
        sourceFiles: ["src/file.ts"],
        redVerificationPending: false,
      },
      debug: { active: true, investigated: true, fixAttempts: 2 },
      verification: { verified: true, verificationWaived: false },
    };

    fs.mkdirSync(path.join(tempDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".pi", "superpowers-state.json"), JSON.stringify(snapshot, null, 2));

    reconstructState(
      {
        sessionManager: {
          getBranch: () => [{ type: "custom", customType: "superpowers_state", data: { workflow: null } }],
        },
      } as any,
      handler,
    );

    expect(handler.getFullState()).toEqual(snapshot);
  });

  test("reconstructState logs warning when state file has invalid JSON", () => {
    const tempDir = withTempCwd();
    const handler = createWorkflowHandler();

    fs.mkdirSync(path.join(tempDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".pi", "superpowers-state.json"), "not valid json{{{");

    const warnSpy = vi.spyOn(logging.log, "warn");

    reconstructState(
      {
        sessionManager: {
          getBranch: () => [],
        },
      } as any,
      handler,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to read state file"));
    warnSpy.mockRestore();
  });

  test("reconstructState falls back to session entries when file does not exist", () => {
    withTempCwd();

    const handler = createWorkflowHandler();
    const snapshot: SuperpowersStateSnapshot = {
      workflow: {
        phases: {
          brainstorm: "complete",
          plan: "active",
          execute: "pending",
          verify: "pending",
          review: "pending",
          finish: "pending",
        },
        currentPhase: "plan",
        artifacts: {
          brainstorm: "docs/superpowers/specs/session-design.md",
          plan: null,
          execute: null,
          verify: null,
          review: null,
          finish: null,
        },
        prompted: {
          brainstorm: true,
          plan: false,
          execute: false,
          verify: false,
          review: false,
          finish: false,
        },
      },
      tdd: {
        phase: "green",
        testFiles: ["tests/session.test.ts"],
        sourceFiles: ["src/session.ts"],
        redVerificationPending: false,
      },
      debug: { active: true, investigated: true, fixAttempts: 1 },
      verification: { verified: false, verificationWaived: true },
    };

    reconstructState(
      {
        sessionManager: {
          getBranch: () => [{ type: "custom", customType: "superpowers_state", data: snapshot }],
        },
      } as any,
      handler,
    );

    expect(handler.getFullState()).toEqual(snapshot);
  });
});

describe("workflow-monitor state reconstruction + persistence wiring", () => {
  test("reconstructs full state from superpowers_state entry", () => {
    const handler = createWorkflowHandler();
    const snapshot: SuperpowersStateSnapshot = {
      workflow: {
        phases: {
          brainstorm: "complete",
          plan: "active",
          execute: "pending",
          verify: "pending",
          review: "pending",
          finish: "pending",
        },
        currentPhase: "plan",
        artifacts: {
          brainstorm: "docs/superpowers/specs/2026-02-15-feature-design.md",
          plan: null,
          execute: null,
          verify: null,
          review: null,
          finish: null,
        },
        prompted: {
          brainstorm: true,
          plan: false,
          execute: false,
          verify: false,
          review: false,
          finish: false,
        },
      },
      tdd: {
        phase: "green",
        testFiles: ["tests/x.test.ts"],
        sourceFiles: ["src/x.ts"],
        redVerificationPending: false,
      },
      debug: { active: true, investigated: true, fixAttempts: 2 },
      verification: { verified: false, verificationWaived: true },
    };

    reconstructState(
      {
        sessionManager: {
          getBranch: () => [{ type: "custom", customType: "superpowers_state", data: snapshot }],
        },
      } as any,
      handler,
      false,
    );

    expect(handler.getFullState()).toEqual(snapshot);
  });

  test("reconstructs workflow from legacy workflow_tracker_state entry and defaults other monitors", () => {
    const handler = createWorkflowHandler();
    const workflow = new WorkflowTracker().getState();
    workflow.currentPhase = "execute";
    workflow.phases.brainstorm = "complete";
    workflow.phases.plan = "complete";
    workflow.phases.execute = "active";

    reconstructState(
      {
        sessionManager: {
          getBranch: () => [{ type: "custom", customType: WORKFLOW_TRACKER_ENTRY_TYPE, data: workflow }],
        },
      } as any,
      handler,
      false,
    );

    expect(handler.getFullState()).toEqual({
      workflow,
      tdd: { ...TDD_DEFAULTS, testFiles: [], sourceFiles: [] },
      debug: { ...DEBUG_DEFAULTS },
      verification: { ...VERIFICATION_DEFAULTS },
    });
  });

  test("reconstructs fresh defaults when branch has no persisted state entries", () => {
    const handler = createWorkflowHandler();
    handler.handleInputText("/skill:writing-plans");
    handler.restoreTddState("green", ["tests/a.test.ts"], ["src/a.ts"], false);
    handler.recordVerificationWaiver();

    reconstructState(
      {
        sessionManager: {
          getBranch: () => [],
        },
      } as any,
      handler,
      false,
    );

    expect(handler.getFullState()).toEqual({
      workflow: new WorkflowTracker().getState(),
      tdd: { ...TDD_DEFAULTS, testFiles: [], sourceFiles: [] },
      debug: { ...DEBUG_DEFAULTS },
      verification: { ...VERIFICATION_DEFAULTS },
    });
  });

  test("reconstructs using the last matching persisted state entry", () => {
    const handler = createWorkflowHandler();

    const older: SuperpowersStateSnapshot = {
      workflow: {
        phases: {
          brainstorm: "active",
          plan: "pending",
          execute: "pending",
          verify: "pending",
          review: "pending",
          finish: "pending",
        },
        currentPhase: "brainstorm",
        artifacts: { brainstorm: null, plan: null, execute: null, verify: null, review: null, finish: null },
        prompted: { brainstorm: false, plan: false, execute: false, verify: false, review: false, finish: false },
      },
      tdd: { phase: "red", testFiles: ["tests/old.test.ts"], sourceFiles: [], redVerificationPending: false },
      debug: { active: false, investigated: false, fixAttempts: 0 },
      verification: { verified: false, verificationWaived: false },
    };

    const newer: SuperpowersStateSnapshot = {
      workflow: {
        phases: {
          brainstorm: "complete",
          plan: "active",
          execute: "pending",
          verify: "pending",
          review: "pending",
          finish: "pending",
        },
        currentPhase: "plan",
        artifacts: {
          brainstorm: "docs/superpowers/specs/new-design.md",
          plan: null,
          execute: null,
          verify: null,
          review: null,
          finish: null,
        },
        prompted: { brainstorm: true, plan: false, execute: false, verify: false, review: false, finish: false },
      },
      tdd: {
        phase: "green",
        testFiles: ["tests/new.test.ts"],
        sourceFiles: ["src/new.ts"],
        redVerificationPending: false,
      },
      debug: { active: true, investigated: true, fixAttempts: 1 },
      verification: { verified: true, verificationWaived: false },
    };

    reconstructState(
      {
        sessionManager: {
          getBranch: () => [
            { type: "custom", customType: "superpowers_state", data: older },
            { type: "custom", customType: WORKFLOW_TRACKER_ENTRY_TYPE, data: new WorkflowTracker().getState() },
            { type: "custom", customType: "superpowers_state", data: newer },
          ],
        },
      } as any,
      handler,
      false,
    );

    expect(handler.getFullState()).toEqual(newer);
  });

  test("persists when a skill file is read via read tool result", async () => {
    const fake = createFakePi({ withAppendEntry: true });
    const tempDir = process.cwd(); // createFakePi already called withTempCwd()
    workflowMonitorExtension(fake.api as any);

    const onToolResult = getSingleHandler(fake.handlers, "tool_result");

    await onToolResult(
      {
        toolCallId: "call-1",
        toolName: "read",
        input: { path: "/home/pi/workspace/pi-superpowers-plus/skills/writing-plans/SKILL.md" },
        content: [{ type: "text", text: "ok" }],
        details: {},
      },
      { hasUI: false, sessionManager: { getBranch: () => [] }, ui: { setWidget: () => {} } },
    );

    expect(fake.appendedEntries.length).toBe(1);
    expect(fake.appendedEntries[0]?.customType).toBe("superpowers_state");
    expect(fake.appendedEntries[0]?.data.workflow.currentPhase).toBe("plan");

    const statePath = path.join(tempDir, ".pi", "superpowers-state.json");
    expect(fs.existsSync(statePath)).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(persisted.workflow.currentPhase).toBe("plan");
  });
});
