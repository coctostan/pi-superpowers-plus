import { DebugMonitor, type DebugViolation } from "./debug-monitor";
import { isSourceFile } from "./heuristics";
import { isInvestigationCommand } from "./investigation";
import { TddMonitor, type TddPhase, type TddViolation } from "./tdd-monitor";
import { parseTestCommand, parseTestResult } from "./test-runner";
import { VerificationMonitor, type VerificationViolation } from "./verification-monitor";
import {
  WorkflowTracker,
  type WorkflowTrackerState,
  type Phase,
} from "./workflow-tracker";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export type Violation = TddViolation | DebugViolation;

export interface ToolCallResult {
  violation: Violation | null;
}

export interface WorkflowHandler {
  handleToolCall(toolName: string, input: Record<string, any>): ToolCallResult;
  handleReadOrInvestigation(toolName: string, path: string): void;
  handleBashResult(command: string, output: string, exitCode: number | undefined): void;
  handleBashInvestigation(command: string): void;
  isDebugActive(): boolean;
  getDebugFixAttempts(): number;
  getTddPhase(): string;
  getWidgetText(): string;
  getTddState(): ReturnType<TddMonitor["getState"]>;
  checkCommitGate(command: string): VerificationViolation | null;
  recordVerificationWaiver(): void;
  restoreTddState(
    phase: TddPhase,
    testFiles: string[],
    sourceFiles: string[],
    redVerificationPending?: boolean
  ): void;
  handleInputText(text: string): boolean;
  handleFileWritten(path: string): boolean;
  handlePlanTrackerToolCall(input: Record<string, any>): boolean;
  getWorkflowState(): WorkflowTrackerState | null;
  restoreWorkflowStateFromBranch(branch: SessionEntry[]): void;
  markWorkflowPrompted(phase: Phase): boolean;
  completeCurrentWorkflowPhase(): boolean;
  advanceWorkflowTo(phase: Phase): boolean;
  skipWorkflowPhases(phases: Phase[]): boolean;
  resetState(): void;
}

export function createWorkflowHandler(): WorkflowHandler {
  const tdd = new TddMonitor();
  const debug = new DebugMonitor();
  const verification = new VerificationMonitor();
  const tracker = new WorkflowTracker();
  let debugFailStreak = 0;

  return {
    handleToolCall(toolName: string, input: Record<string, any>): ToolCallResult {
      if (toolName === "write" || toolName === "edit") {
        const path = input.path as string | undefined;
        if (path) {
          if (isSourceFile(path)) {
            verification.onSourceWritten();
          }

          // Debug violations take precedence, and when debug is active we don't
          // additionally enforce TDD write-order violations.
          if (debug.isActive() && isSourceFile(path)) {
            const debugViolation = debug.onSourceWritten(path);
            return { violation: debugViolation };
          }

          const tddViolation = tdd.onFileWritten(path);
          return { violation: tddViolation };
        }
      }
      return { violation: null };
    },

    handleReadOrInvestigation(toolName: string, _path: string): void {
      if (toolName === "read") {
        debug.onInvestigation();
      }
    },

    handleBashResult(command: string, output: string, exitCode: number | undefined): void {
      if (isInvestigationCommand(command)) {
        debug.onInvestigation();
      }

      if (/\bgit\s+commit\b/.test(command)) {
        debugFailStreak = 0;
        tdd.onCommit();
        debug.onCommit();
        return;
      }

      if (parseTestCommand(command)) {
        const passed = parseTestResult(output, exitCode);
        if (passed !== null) {
          if (passed) {
            verification.recordVerification();
          } else {
            verification.reset();
          }

          const excludeFromDebug =
            !passed && tdd.getPhase() === "red" && tdd.isRedVerificationPending();

          tdd.onTestResult(passed);

          if (passed) {
            debugFailStreak = 0;
            debug.onTestPassed();
          } else if (!excludeFromDebug) {
            debugFailStreak += 1;
            if (debugFailStreak >= 2) {
              debug.onTestFailed();
            }
          }
        }
      }
    },

    handleBashInvestigation(command: string): void {
      if (isInvestigationCommand(command)) {
        debug.onInvestigation();
      }
    },

    isDebugActive(): boolean {
      return debug.isActive();
    },

    getDebugFixAttempts(): number {
      return debug.getFixAttempts();
    },

    getTddPhase(): string {
      return tdd.getPhase();
    },

    getWidgetText(): string {
      const parts: string[] = [];

      const phase = tdd.getPhase();
      if (phase !== "idle") {
        parts.push(`TDD: ${phase.toUpperCase()}`);
      }

      if (debug.isActive()) {
        parts.push("Debug: ACTIVE");
      }

      return parts.join(" | ");
    },

    getTddState() {
      return tdd.getState();
    },

    checkCommitGate(command: string) {
      return verification.checkCommitGate(command);
    },

    recordVerificationWaiver() {
      verification.recordVerificationWaiver();
    },

    restoreTddState(
      phase: TddPhase,
      testFiles: string[],
      sourceFiles: string[],
      redVerificationPending = false
    ) {
      tdd.setState(phase, testFiles, sourceFiles, redVerificationPending);
    },

    handleInputText(text: string) {
      return tracker.onInputText(text);
    },

    handleFileWritten(path: string) {
      return tracker.onFileWritten(path);
    },

    handlePlanTrackerToolCall(input: Record<string, any>) {
      if (input.action === "init") {
        return tracker.onPlanTrackerInit();
      }
      return false;
    },

    getWorkflowState() {
      return tracker.getState();
    },

    restoreWorkflowStateFromBranch(branch: SessionEntry[]) {
      const state = WorkflowTracker.reconstructFromBranch(branch);
      if (state) {
        tracker.setState(state);
      }
    },

    markWorkflowPrompted(phase: Phase) {
      return tracker.markPrompted(phase);
    },

    completeCurrentWorkflowPhase() {
      return tracker.completeCurrent();
    },

    advanceWorkflowTo(phase) {
      return tracker.advanceTo(phase);
    },

    skipWorkflowPhases(phases) {
      return tracker.skipPhases(phases);
    },

    resetState() {
      debugFailStreak = 0;
      tdd.onCommit();
      debug.onCommit();
      verification.reset();
      tracker.setState(new WorkflowTracker().getState());
    },
  };
}
