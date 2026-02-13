/**
 * Workflow Monitor Extension
 *
 * Observes tool_call and tool_result events to:
 * - Track TDD phase (RED→GREEN→REFACTOR) and inject warnings on violations
 * - Track debug fix-fail cycles and inject warnings on investigation skips / thrashing
 * - Show workflow state in TUI widget
 * - Register workflow_reference tool for on-demand reference content
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { createWorkflowHandler, type Violation } from "./workflow-monitor/workflow-handler";
import { type VerificationViolation } from "./workflow-monitor/verification-monitor";
import { getTddViolationWarning } from "./workflow-monitor/warnings";
import {
  getDebugViolationWarning,
  getVerificationViolationWarning,
  type DebugViolationType,
} from "./workflow-monitor/warnings";
import { loadReference, REFERENCE_TOPICS } from "./workflow-monitor/reference-tool";
import { parseTestCommand, parseTestResult } from "./workflow-monitor/test-runner";
import {
  WORKFLOW_PHASES,
  WORKFLOW_TRACKER_ENTRY_TYPE,
  computeBoundaryToPrompt,
  type TransitionBoundary,
  type WorkflowTrackerState,
} from "./workflow-monitor/workflow-tracker";
import { getTransitionPrompt } from "./workflow-monitor/workflow-transitions";
import { getCurrentGitRef } from "./workflow-monitor/git";

export default function (pi: ExtensionAPI) {
  const handler = createWorkflowHandler();

  // Pending warnings are keyed by toolCallId to avoid cross-call leakage when
  // tool results are interleaved.
  const pendingViolations = new Map<string, Violation>();
  const pendingVerificationViolations = new Map<string, VerificationViolation>();
  const pendingBranchGates = new Map<string, string>();
  let branchNoticeShown = false;
  let branchConfirmed = false;

  const persistWorkflowState = () => {
    pi.appendEntry(WORKFLOW_TRACKER_ENTRY_TYPE, handler.getWorkflowState());
  };

  const phaseToSkill: Record<string, string> = {
    brainstorm: "brainstorming",
    plan: "writing-plans",
    execute: "executing-plans",
    verify: "verification-before-completion",
    review: "requesting-code-review",
    finish: "finishing-a-development-branch",
  };

  const boundaryToPhase: Record<TransitionBoundary, keyof typeof phaseToSkill> = {
    design_committed: "brainstorm",
    plan_ready: "plan",
    execution_complete: "execute",
    verification_passed: "verify",
    review_complete: "review",
  };

  // --- State reconstruction on session events ---
  for (const event of [
    "session_start",
    "session_switch",
    "session_fork",
    "session_tree",
  ] as const) {
    pi.on(event, async (_event, ctx) => {
      handler.resetState();
      handler.restoreWorkflowStateFromBranch(ctx.sessionManager.getBranch());
      pendingViolations.clear();
      pendingVerificationViolations.clear();
      pendingBranchGates.clear();
      branchNoticeShown = false;
      branchConfirmed = false;
      updateWidget(ctx);
    });
  }

  // --- Input observation (skill detection) ---
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    const text = (event.input as string | undefined) ?? "";
    if (handler.handleInputText(text)) {
      persistWorkflowState();
      updateWidget(ctx);
    }
  });

  // --- Tool call observation (detect file writes + verification gate) ---
  pi.on("tool_call", async (event, ctx) => {
    const toolCallId = event.toolCallId;

    if (event.toolName === "bash") {
      const command = ((event.input as Record<string, any>).command as string | undefined) ?? "";
      const verificationViolation = handler.checkCommitGate(command);
      if (verificationViolation) {
        pendingVerificationViolations.set(toolCallId, verificationViolation);
      }
    }

    const input = event.input as Record<string, any>;
    const result = handler.handleToolCall(event.toolName, input);
    if (result.violation) {
      pendingViolations.set(toolCallId, result.violation);
    }

    let changed = false;

    if (event.toolName === "write" || event.toolName === "edit") {
      const path = input.path as string | undefined;
      if (path) {
        changed = handler.handleFileWritten(path) || changed;
      }

      if (!branchConfirmed) {
        const ref = getCurrentGitRef();
        branchConfirmed = true;

        if (ref) {
          pendingBranchGates.set(
            toolCallId,
            `⚠️ First write of this session. You're on branch \`${ref}\`.\n` +
              "Confirm with the user this is the correct branch before continuing, or create a new branch/worktree."
          );
        } else {
          // Not a git repo: disable branch messages silently.
          branchNoticeShown = true;
        }
      }
    }

    if (event.toolName === "plan_tracker") {
      changed = handler.handlePlanTrackerToolCall(input) || changed;
    }

    if (changed) {
      persistWorkflowState();
      updateWidget(ctx);
    }
  });

  // --- Tool result modification (inject warnings + track investigation) ---
  pi.on("tool_result", async (event, ctx) => {
    const toolCallId = event.toolCallId;

    // Handle read tool as investigation signal
    if (event.toolName === "read") {
      const path = (event.input as Record<string, any>).path as string ?? "";
      handler.handleReadOrInvestigation("read", path);
    }

    const injected: string[] = [];

    // Layer 1: announce current branch on first tool result in session.
    if (!branchNoticeShown) {
      const ref = getCurrentGitRef();
      if (ref) {
        injected.push(`📌 Current branch: \`${ref}\``);
      } else {
        branchConfirmed = true;
      }
      branchNoticeShown = true;
    }

    // Inject violation warning on write/edit for the matching tool call.
    if (event.toolName === "write" || event.toolName === "edit") {
      const violation = pendingViolations.get(toolCallId);
      if (violation) {
        injected.push(formatViolationWarning(violation));
      }
      pendingViolations.delete(toolCallId);
    }

    // Handle bash results (test runs, commits, investigation)
    if (event.toolName === "bash") {
      const command = (event.input as Record<string, any>).command as string ?? "";
      const output = event.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const exitCode = (event.details as any)?.exitCode as number | undefined;
      handler.handleBashResult(command, output, exitCode);

      const isTestCommand = parseTestCommand(command);
      const passed = isTestCommand ? parseTestResult(output, exitCode) : null;
      if (passed === true) {
        const state = handler.getWorkflowState();
        if (state?.currentPhase === "verify" && state.phases.verify === "active") {
          if (handler.completeCurrentWorkflowPhase()) {
            persistWorkflowState();
          }
        }
      }

      const verificationViolation = pendingVerificationViolations.get(toolCallId);
      if (verificationViolation) {
        injected.push(
          getVerificationViolationWarning(verificationViolation.type, verificationViolation.command)
        );
      }
      pendingVerificationViolations.delete(toolCallId);
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const branchGate = pendingBranchGates.get(toolCallId);
      if (branchGate) {
        injected.push(branchGate);
      }
      pendingBranchGates.delete(toolCallId);
    }

    if (injected.length > 0) {
      updateWidget(ctx);
      return {
        content: [{ type: "text", text: injected.join("\n\n") }, ...event.content],
      };
    }

    updateWidget(ctx);
    return undefined;
  });

  // --- Boundary prompting at natural handoff points ---
  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const latestState = handler.getWorkflowState();
    if (!latestState) return;

    const boundary = computeBoundaryToPrompt(latestState);
    if (!boundary) return;

    const boundaryPhase = boundaryToPhase[boundary];
    const prompt = getTransitionPrompt(boundary, latestState.artifacts[boundaryPhase]);

    const options = prompt.options.map((o) => ({ label: o.label, value: o.choice }));
    const result = await ctx.ui.select(prompt.title, options as any);

    const selected =
      typeof result === "string"
        ? prompt.options.find((o) => o.choice === result || o.label === result)?.choice
        : result?.value ?? result?.choice ?? null;

    const marked = handler.markWorkflowPrompted(boundaryPhase);
    if (marked) {
      persistWorkflowState();
      updateWidget(ctx);
    }

    const nextSkill = phaseToSkill[prompt.nextPhase] ?? "writing-plans";
    const nextInSession = `/skill:${nextSkill}`;
    const fresh = `/workflow-next ${prompt.nextPhase}${prompt.artifactPath ? ` ${prompt.artifactPath}` : ""}`;
    const finishReminder =
      "Before finishing:\n" +
      "- Does this work require documentation updates? (README, CHANGELOG, API docs, inline docs)\n" +
      "- What was learned during this implementation? (surprises, codebase knowledge, things to do differently)\n\n";

    if (selected === "next") {
      ctx.ui.setEditorText(
        prompt.nextPhase === "finish" ? finishReminder + nextInSession : nextInSession
      );
    } else if (selected === "fresh") {
      ctx.ui.setEditorText(
        prompt.nextPhase === "finish" ? finishReminder + fresh : fresh
      );
    } else if (selected === "skip") {
      // Explicit user-confirmed skip: mark the next phase as skipped, then move on.
      handler.skipWorkflowPhases([prompt.nextPhase]);

      const nextIdx = WORKFLOW_PHASES.indexOf(prompt.nextPhase);
      const phaseAfterSkip = WORKFLOW_PHASES[nextIdx + 1] ?? prompt.nextPhase;
      handler.advanceWorkflowTo(phaseAfterSkip);

      persistWorkflowState();
      updateWidget(ctx);
      const skipSkill = phaseToSkill[phaseAfterSkip] ?? "writing-plans";
      ctx.ui.setEditorText(`/skill:${skipSkill}`);
    }
  });

  // --- Format violation warning based on type ---
  function formatViolationWarning(violation: Violation): string {
    if (violation.type === "source-before-test" || violation.type === "source-during-red") {
      return getTddViolationWarning(violation.type, violation.file);
    }
    return getDebugViolationWarning(
      violation.type as DebugViolationType,
      violation.file,
      "fixAttempts" in violation ? violation.fixAttempts : 0
    );
  }

  function formatPhaseStrip(state: WorkflowTrackerState | null, theme: any): string {
    if (!state?.currentPhase) return "";

    const arrow = theme.fg("dim", " → ");
    return WORKFLOW_PHASES.map((phase) => {
      const status = state.phases[phase];
      if (state.currentPhase === phase) return theme.fg("accent", `[${phase}]`);
      if (status === "complete") return theme.fg("success", `✓${phase}`);
      if (status === "skipped") return theme.fg("dim", `–${phase}`);
      return theme.fg("dim", phase);
    }).join(arrow);
  }

  // --- TUI Widget ---
  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const tddPhase = handler.getTddPhase().toUpperCase();
    const hasDebug = handler.isDebugActive();
    const workflow = handler.getWorkflowState();
    const hasWorkflow = !!workflow?.currentPhase;

    if (!hasWorkflow && tddPhase === "IDLE" && !hasDebug) {
      ctx.ui.setWidget("workflow_monitor", undefined);
      return;
    }

    ctx.ui.setWidget("workflow_monitor", (_tui, theme) => {
      const parts: string[] = [];

      const phaseStrip = formatPhaseStrip(workflow, theme);
      if (phaseStrip) {
        parts.push(phaseStrip);
      }

      // TDD phase
      if (tddPhase !== "IDLE") {
        const colorMap: Record<string, string> = {
          RED: "error",
          GREEN: "success",
          REFACTOR: "accent",
        };
        parts.push(theme.fg(colorMap[tddPhase] ?? "muted", `TDD: ${tddPhase}`));
      }

      // Debug state
      if (hasDebug) {
        const attempts = handler.getDebugFixAttempts();
        if (attempts >= 3) {
          parts.push(theme.fg("error", `Debug: ${attempts} fix attempts ⚠️`));
        } else if (attempts > 0) {
          parts.push(theme.fg("warning", `Debug: ${attempts} fix attempt${attempts !== 1 ? "s" : ""}`));
        } else {
          parts.push(theme.fg("accent", "Debug: investigating"));
        }
      }

      return parts.length > 0
        ? new Text(parts.join(theme.fg("dim", "  |  ")), 0, 0)
        : undefined;
    });
  }

  pi.registerCommand("workflow-next", {
    description: "Start a fresh session for the next workflow phase (optionally referencing an artifact path)",
    async handler(args, ctx) {
      if (!ctx.hasUI) {
        ctx.ui.notify("workflow-next requires interactive mode", "error");
        return;
      }

      const [phase, artifact] = args.trim().split(/\s+/, 2);
      const validPhases = new Set(["brainstorm", "plan", "execute", "verify", "review", "finish"]);
      if (!phase || !validPhases.has(phase)) {
        ctx.ui.notify("Usage: /workflow-next <phase> [artifact-path]  (phase: brainstorm|plan|execute|verify|review|finish)", "error");
        return;
      }

      const parentSession = ctx.sessionManager.getSessionFile();
      const res = await ctx.newSession({ parentSession });
      if (res.cancelled) return;

      const lines: string[] = [];
      if (artifact) lines.push(`Continue from artifact: ${artifact}`);

      if (phase === "plan") {
        lines.push("Use /skill:writing-plans to create the implementation plan.");
      } else if (phase === "execute") {
        lines.push("Use /skill:executing-plans (or /skill:subagent-driven-development) to execute the plan.");
      } else if (phase === "verify") {
        lines.push("Use /skill:verification-before-completion to verify before finishing.");
      } else if (phase === "review") {
        lines.push("Use /skill:requesting-code-review to get review.");
      } else if (phase === "finish") {
        lines.push("Use /skill:finishing-a-development-branch to integrate/ship.");
      }

      ctx.ui.setEditorText(lines.join("\n"));
      ctx.ui.notify("New session ready. Submit when ready.", "info");
    },
  });

  // --- Reference Tool ---
  pi.registerTool({
    name: "workflow_reference",
    label: "Workflow Reference",
    description: `Detailed guidance for workflow skills. Topics: ${REFERENCE_TOPICS.join(", ")}`,
    parameters: Type.Object({
      topic: StringEnum(REFERENCE_TOPICS as unknown as readonly [string, ...string[]], {
        description: "Reference topic to load",
      }),
    }),
    async execute(_toolCallId, params) {
      const content = await loadReference(params.topic);
      return {
        content: [{ type: "text", text: content }],
        details: { topic: params.topic },
      };
    },
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("workflow_reference "));
      text += theme.fg("accent", args.topic);
      return new Text(text, 0, 0);
    },
    renderResult(result, _options, theme) {
      const topic = (result.details as any)?.topic ?? "unknown";
      const content = result.content[0];
      const len = content?.type === "text" ? content.text.length : 0;
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("muted", `${topic} (${len} chars)`),
        0,
        0
      );
    },
  });
}
