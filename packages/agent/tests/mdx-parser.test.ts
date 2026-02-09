import { describe, test, expect } from "bun:test";
import { parseAgentMdx } from "../src/runtime/mdx-parser.ts";

describe("parseAgentMdx", () => {
  describe("identity extraction", () => {
    test("parses name from heading", () => {
      const def = parseAgentMdx(`# Agent: TestBot\n\n## Purpose\nDo things.`);
      expect(def.identity.name).toBe("TestBot");
    });

    test("parses purpose section", () => {
      const def = parseAgentMdx(`# Agent: X\n\n## Purpose\nHelp with tasks.`);
      expect(def.identity.purpose).toBe("Help with tasks.");
    });

    test("parses capabilities as list", () => {
      const def = parseAgentMdx(
        `# Agent: X\n\n## Purpose\nY\n\n## Capabilities\n- Do A\n- Do B\n- Do C`,
      );
      expect(def.identity.capabilities).toEqual(["Do A", "Do B", "Do C"]);
    });

    test("parses constraints as list", () => {
      const def = parseAgentMdx(`# Agent: X\n\n## Purpose\nY\n\n## Constraints\n- No X\n- No Y`);
      expect(def.identity.constraints).toEqual(["No X", "No Y"]);
    });

    test("parses personality", () => {
      const def = parseAgentMdx(
        `# Agent: X\n\n## Purpose\nY\n\n## Personality\nFriendly and helpful.`,
      );
      expect(def.identity.personality).toBe("Friendly and helpful.");
    });

    test("handles frontmatter", () => {
      const def = parseAgentMdx(`---\nname: TestBot\n---\n\n# Agent: TestBot\n\n## Purpose\nY`);
      expect(def.identity.name).toBe("TestBot");
    });

    test("returns empty tools when none defined", () => {
      const def = parseAgentMdx(`# Agent: X\n\n## Purpose\nY`);
      expect(def.tools).toEqual([]);
    });
  });

  describe("tool extraction", () => {
    test("extracts a single tool", () => {
      const source = `# Agent: X

## Purpose
Y

<Tool name="greet" description="Say hello">
  <Param name="name" type="string" description="Who to greet" />

\`\`\`typescript
async function execute(params: { name: string }, ctx: any) {
  return "Hello " + params.name
}
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools).toHaveLength(1);
      expect(def.tools[0].name).toBe("greet");
      expect(def.tools[0].description).toBe("Say hello");
      expect(def.tools[0].params).toHaveLength(1);
      expect(def.tools[0].params[0].name).toBe("name");
      expect(def.tools[0].params[0].type).toBe("string");
      expect(def.tools[0].code).toContain("Hello");
    });

    test("extracts multiple tools", () => {
      const source = `# Agent: X

## Purpose
Y

<Tool name="tool_a" description="First tool">

\`\`\`typescript
async function execute(params: {}, ctx: any) {
  return "a"
}
\`\`\`
</Tool>

<Tool name="tool_b" description="Second tool">

\`\`\`typescript
async function execute(params: {}, ctx: any) {
  return "b"
}
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools).toHaveLength(2);
      expect(def.tools[0].name).toBe("tool_a");
      expect(def.tools[1].name).toBe("tool_b");
    });

    test("strips tool blocks from identity content", () => {
      const source = `# Agent: X

## Purpose
Do things.

<Tool name="hidden" description="Should not appear in purpose">

\`\`\`typescript
async function execute(params: {}, ctx: any) { return "x" }
\`\`\`
</Tool>

## Capabilities
- Be helpful`;

      const def = parseAgentMdx(source);
      expect(def.identity.purpose).toBe("Do things.");
      expect(def.identity.capabilities).toEqual(["Be helpful"]);
      expect(def.tools).toHaveLength(1);
    });
  });

  describe("param parsing", () => {
    test("parses multiple params with different types", () => {
      const source = `# Agent: X

## Purpose
Y

<Tool name="calc" description="Calculate">
  <Param name="a" type="number" description="First number" />
  <Param name="b" type="number" description="Second number" />
  <Param name="verbose" type="boolean" required="false" description="Show work" />

\`\`\`typescript
async function execute(params: any, ctx: any) { return "0" }
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      const params = def.tools[0].params;
      expect(params).toHaveLength(3);

      expect(params[0]).toEqual({
        name: "a",
        type: "number",
        description: "First number",
        required: true,
      });

      expect(params[1]).toEqual({
        name: "b",
        type: "number",
        description: "Second number",
        required: true,
      });

      expect(params[2]).toEqual({
        name: "verbose",
        type: "boolean",
        description: "Show work",
        required: false,
      });
    });

    test("defaults type to string", () => {
      const source = `# Agent: X
## Purpose
Y
<Tool name="t" description="D">
  <Param name="x" description="Something" />

\`\`\`typescript
async function execute(params: any, ctx: any) { return "" }
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools[0].params[0].type).toBe("string");
    });

    test("defaults required to true", () => {
      const source = `# Agent: X
## Purpose
Y
<Tool name="t" description="D">
  <Param name="x" type="string" />

\`\`\`typescript
async function execute(params: any, ctx: any) { return "" }
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools[0].params[0].required).toBe(true);
    });

    test("handles tool with no params", () => {
      const source = `# Agent: X
## Purpose
Y
<Tool name="now" description="Get time">

\`\`\`typescript
async function execute(params: {}, ctx: any) { return new Date().toISOString() }
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools[0].params).toEqual([]);
    });
  });

  describe("code block extraction", () => {
    test("extracts typescript code block", () => {
      const source = `# Agent: X
## Purpose
Y
<Tool name="t" description="D">

\`\`\`typescript
async function execute(params: {}, ctx: any) {
  return "hello"
}
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools[0].code).toContain('return "hello"');
    });

    test("extracts ts code block", () => {
      const source = `# Agent: X
## Purpose
Y
<Tool name="t" description="D">

\`\`\`ts
async function execute(params: {}, ctx: any) {
  return "hello"
}
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools[0].code).toContain('return "hello"');
    });

    test("returns empty string for missing code block", () => {
      const source = `# Agent: X
## Purpose
Y
<Tool name="t" description="D">
  <Param name="x" type="string" />
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools[0].code).toBe("");
    });
  });

  describe("edge cases", () => {
    test("handles empty source", () => {
      const def = parseAgentMdx("");
      expect(def.identity.name).toBe("UnnamedAgent");
      expect(def.tools).toEqual([]);
    });

    test("handles source with only frontmatter", () => {
      const def = parseAgentMdx("---\nname: Test\n---\n");
      expect(def.tools).toEqual([]);
    });

    test("handles description with special characters", () => {
      const source = `# Agent: X
## Purpose
Y
<Tool name="t" description="Fetch data from API (v2)">

\`\`\`typescript
async function execute(params: {}, ctx: any) { return "" }
\`\`\`
</Tool>`;

      const def = parseAgentMdx(source);
      expect(def.tools[0].description).toBe("Fetch data from API (v2)");
    });
  });
});
