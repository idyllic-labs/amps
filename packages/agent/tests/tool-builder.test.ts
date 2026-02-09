import { describe, test, expect } from "bun:test";
import { buildToolsFromDefs } from "../src/runtime/tool-builder.ts";
import type { ParsedToolDef } from "../src/runtime/mdx-parser.ts";
import type { ToolContext, AgentToolResult } from "../src/types/index.ts";

function getText(result: AgentToolResult<any>): string {
  const first = result.content[0];
  return first && "text" in first ? first.text : "";
}

const testCtx: ToolContext = {
  agentDir: "/tmp/test-agent",
  cwd: "/tmp/test-agent",
  log: async () => {},
};

describe("buildToolsFromDefs", () => {
  test("builds a tool from a simple definition", () => {
    const defs: ParsedToolDef[] = [
      {
        name: "hello",
        description: "Say hello",
        params: [{ name: "name", type: "string", description: "Name", required: true }],
        code: `async function execute(params: any, ctx: any) { return "Hello " + params.name }`,
      },
    ];

    const tools = buildToolsFromDefs(defs, testCtx);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("hello");
    expect(tools[0].label).toBe("hello");
    expect(tools[0].description).toBe("Say hello");
  });

  test("builds correct TypeBox schema for string params", () => {
    const defs: ParsedToolDef[] = [
      {
        name: "t",
        description: "D",
        params: [{ name: "input", type: "string", description: "Input text", required: true }],
        code: `async function execute(params: any, ctx: any) { return "" }`,
      },
    ];

    const tools = buildToolsFromDefs(defs, testCtx);
    const schema = tools[0].parameters;
    expect(schema.type).toBe("object");
    expect(schema.properties.input).toBeDefined();
  });

  test("builds schema with number params", () => {
    const defs: ParsedToolDef[] = [
      {
        name: "t",
        description: "D",
        params: [{ name: "count", type: "number", description: "Count", required: true }],
        code: `async function execute(params: any, ctx: any) { return "" }`,
      },
    ];

    const tools = buildToolsFromDefs(defs, testCtx);
    const schema = tools[0].parameters;
    expect(schema.properties.count).toBeDefined();
  });

  test("builds schema with boolean params", () => {
    const defs: ParsedToolDef[] = [
      {
        name: "t",
        description: "D",
        params: [{ name: "verbose", type: "boolean", description: "Verbose", required: false }],
        code: `async function execute(params: any, ctx: any) { return "" }`,
      },
    ];

    const tools = buildToolsFromDefs(defs, testCtx);
    const schema = tools[0].parameters;
    expect(schema.properties.verbose).toBeDefined();
  });

  test("builds tool with no params", () => {
    const defs: ParsedToolDef[] = [
      {
        name: "now",
        description: "Get time",
        params: [],
        code: `async function execute(params: any, ctx: any) { return new Date().toISOString() }`,
      },
    ];

    const tools = buildToolsFromDefs(defs, testCtx);
    expect(tools[0].parameters.type).toBe("object");
    expect(Object.keys(tools[0].parameters.properties)).toHaveLength(0);
  });

  test("builds multiple tools", () => {
    const defs: ParsedToolDef[] = [
      {
        name: "a",
        description: "Tool A",
        params: [],
        code: `async function execute(params: any, ctx: any) { return "a" }`,
      },
      {
        name: "b",
        description: "Tool B",
        params: [],
        code: `async function execute(params: any, ctx: any) { return "b" }`,
      },
    ];

    const tools = buildToolsFromDefs(defs, testCtx);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("a");
    expect(tools[1].name).toBe("b");
  });

  describe("execution", () => {
    test("executes tool and returns result", async () => {
      const defs: ParsedToolDef[] = [
        {
          name: "add",
          description: "Add numbers",
          params: [
            { name: "a", type: "number", required: true },
            { name: "b", type: "number", required: true },
          ],
          code: `async function execute(params: any, ctx: any) { return String(params.a + params.b) }`,
        },
      ];

      const tools = buildToolsFromDefs(defs, testCtx);
      const result = await tools[0].execute("call-1", { a: 3, b: 4 });
      expect(getText(result)).toBe("7");
    });

    test("coerces non-string return to string", async () => {
      const defs: ParsedToolDef[] = [
        {
          name: "num",
          description: "Return number",
          params: [],
          code: `async function execute(params: any, ctx: any) { return 42 }`,
        },
      ];

      const tools = buildToolsFromDefs(defs, testCtx);
      const result = await tools[0].execute("call-1", {});
      expect(getText(result)).toBe("42");
    });

    test("catches errors and returns error text", async () => {
      const defs: ParsedToolDef[] = [
        {
          name: "fail",
          description: "Always fails",
          params: [],
          code: `async function execute(params: any, ctx: any) { throw new Error("boom") }`,
        },
      ];

      const tools = buildToolsFromDefs(defs, testCtx);
      const result = await tools[0].execute("call-1", {});
      expect(getText(result)).toContain("Error: boom");
    });

    test("tool has access to params", async () => {
      const defs: ParsedToolDef[] = [
        {
          name: "echo",
          description: "Echo input",
          params: [{ name: "message", type: "string", required: true }],
          code: `async function execute(params: any, ctx: any) { return params.message }`,
        },
      ];

      const tools = buildToolsFromDefs(defs, testCtx);
      const result = await tools[0].execute("call-1", { message: "hello world" });
      expect(getText(result)).toBe("hello world");
    });

    test("tool has access to ctx", async () => {
      const defs: ParsedToolDef[] = [
        {
          name: "dir",
          description: "Get agent dir",
          params: [],
          code: `async function execute(params: any, ctx: any) { return ctx.agentDir }`,
        },
      ];

      const tools = buildToolsFromDefs(defs, testCtx);
      const result = await tools[0].execute("call-1", {});
      expect(getText(result)).toBe("/tmp/test-agent");
    });

    test("tool can use fetch (Bun globals available)", async () => {
      const defs: ParsedToolDef[] = [
        {
          name: "check_fetch",
          description: "Check fetch exists",
          params: [],
          code: `async function execute(params: any, ctx: any) { return typeof fetch }`,
        },
      ];

      const tools = buildToolsFromDefs(defs, testCtx);
      const result = await tools[0].execute("call-1", {});
      expect(getText(result)).toBe("function");
    });

    test("tool can use async/await", async () => {
      const defs: ParsedToolDef[] = [
        {
          name: "async_test",
          description: "Async test",
          params: [],
          code: `async function execute(params: any, ctx: any) {
  const p = new Promise(resolve => setTimeout(() => resolve("done"), 10))
  return await p
}`,
        },
      ];

      const tools = buildToolsFromDefs(defs, testCtx);
      const result = await tools[0].execute("call-1", {});
      expect(getText(result)).toBe("done");
    });
  });
});
