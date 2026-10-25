import { describe, expect, test } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";
import { createFakePi, getSingleHandler } from "./test-helpers";

describe("workflow verification does not trust failed Bash tools", () => {
  test("revokes a prior successful verification when the host reports an error", async () => {
    const fake = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(fake.api as any);
    const onToolResult = getSingleHandler(fake.handlers, "tool_result");
    const ctx = { hasUI: false, ui: { setWidget: () => {} } };

    await onToolResult(
      {
        toolCallId: "success",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: "1 passed" }],
        details: {},
        isError: false,
      },
      ctx,
    );
    expect(fake.appendedEntries.at(-1)?.data.verification.verified).toBe(true);

    await onToolResult(
      {
        toolCallId: "failure",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: "1 passed\n\nCommand exited with code 1" }],
        details: {},
        isError: true,
      },
      ctx,
    );

    expect(fake.appendedEntries.at(-1)?.data.verification.verified).toBe(false);
  });

  test("does not mark verification successful with no confirmed tool or process status", async () => {
    const fake = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(fake.api as any);
    const onToolResult = getSingleHandler(fake.handlers, "tool_result");
    const ctx = { hasUI: false, ui: { setWidget: () => {} } };

    await onToolResult(
      {
        toolCallId: "unknown",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: "1 passed" }],
        details: {},
      },
      ctx,
    );

    expect(fake.appendedEntries.at(-1)?.data.verification.verified).toBe(false);
  });
});
