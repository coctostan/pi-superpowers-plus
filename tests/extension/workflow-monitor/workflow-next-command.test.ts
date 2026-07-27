import { describe, expect, test } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";

describe("/workflow-next", () => {
  test("creates new session and prefills kickoff message", async () => {
    let handler: any;
    const fakePi: any = {
      on() {},
      registerTool() {},
      appendEntry() {},
      registerCommand(_name: string, opts: any) {
        handler = opts.handler;
      },
    };

    workflowMonitorExtension(fakePi);

    const calls: any[] = [];
    const ctx: any = {
      hasUI: true,
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: {
        setEditorText: (t: string) => calls.push(["setEditorText", t]),
        notify: () => {},
      },
      newSession: async () => ({ cancelled: false }),
    };

    await handler("plan docs/superpowers/specs/2026-02-10-x-design.md", ctx);

    expect(calls[0][0]).toBe("setEditorText");
    expect(calls[0][1]).toMatch(/Continue from artifact: docs\/superpowers\/specs\/2026-02-10-x-design\.md/);
  });

  test("rejects invalid phase values", async () => {
    let handler: any;
    const fakePi: any = {
      on() {},
      registerTool() {},
      appendEntry() {},
      registerCommand(_name: string, opts: any) {
        handler = opts.handler;
      },
    };

    workflowMonitorExtension(fakePi);

    let newSessionCalls = 0;
    const notifications: Array<[string, string]> = [];

    const ctx: any = {
      hasUI: true,
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: {
        setEditorText: () => {},
        notify: (message: string, level: string) => notifications.push([message, level]),
      },
      newSession: async () => {
        newSessionCalls += 1;
        return { cancelled: false };
      },
    };

    await handler("nonsense docs/superpowers/plans/foo.md", ctx);

    expect(newSessionCalls).toBe(0);
    expect(notifications[0]?.[0]).toMatch(/Usage: \/workflow-next <phase>/);
    expect(notifications[0]?.[1]).toBe("error");
  });
});
