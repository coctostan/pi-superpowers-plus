import { describe, test, expect } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";

type Handler = (event: any, ctx: any) => any;

function createFakePi() {
  const handlers = new Map<string, Handler[]>();

  return {
    handlers,
    api: {
      on(event: string, handler: Handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      registerTool() {},
      registerCommand() {},
      appendEntry() {},
    },
  };
}

function getSingleHandler(handlers: Map<string, Handler[]>, event: string): Handler {
  const list = handlers.get(event) ?? [];
  expect(list.length).toBeGreaterThan(0);
  return list[0]!;
}

describe("workflow monitor widget", () => {
  test("shows workflow phase strip when a workflow phase is active", async () => {
    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    let renderer: any;
    const ctx = {
      hasUI: true,
      sessionManager: { getBranch: () => [] },
      ui: {
        setWidget: (_id: string, widget: any) => {
          renderer = widget;
        },
        select: async () => "skip",
        setEditorText: () => {},
      },
    };

    const onInput = getSingleHandler(fake.handlers, "input");
    await onInput({ source: "user", input: "/skill:writing-plans" }, ctx);

    expect(renderer).toBeTypeOf("function");

    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };

    const textNode = renderer(null, theme);
    expect(textNode.text).toContain("[plan]");
  });
});
