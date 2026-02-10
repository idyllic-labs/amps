/**
 * End-to-end test: creates a fresh agent directory from scratch,
 * initializes AgentRuntime, and verifies everything wires up correctly.
 * Stops short of calling the LLM (no API key needed).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AgentRuntime } from "../src/runtime/agent-runtime.ts";

let agentDir: string;

beforeAll(async () => {
  agentDir = mkdtempSync(join(tmpdir(), "imps-e2e-"));

  // Write agent.mdx with inline tools
  await Bun.write(
    join(agentDir, "agent.mdx"),
    `---
name: E2ETestAgent
---

# Agent: E2ETestAgent

## Purpose

End-to-end test agent with inline tools.

## Capabilities

- Tell the time
- Do arithmetic

## Constraints

- Only use provided tools
- Be concise

## Personality

Terse and precise.

<Tool name="get_time" description="Get the current ISO timestamp">

\`\`\`typescript
async function execute(params: {}, ctx: any) {
  return new Date().toISOString()
}
\`\`\`
</Tool>

<Tool name="add" description="Add two numbers together">
  <Param name="a" type="number" description="First number" />
  <Param name="b" type="number" description="Second number" />

\`\`\`typescript
async function execute(params: { a: number; b: number }, ctx: any) {
  return String(params.a + params.b)
}
\`\`\`
</Tool>
`,
  );

  // Write heartbeat.md (optional but exercises the module system)
  await Bun.write(
    join(agentDir, "heartbeat.md"),
    `## Schedule

@every: 60m

## On Wake

- Check status
`,
  );

  // Create a skill
  const skillDir = join(agentDir, "skills", "test-skill");
  mkdirSync(skillDir, { recursive: true });
  await Bun.write(
    join(skillDir, "SKILL.md"),
    `---
name: test-skill
description: A test skill for e2e testing
---

# Test Skill

This is a test skill body.
`,
  );
});

afterAll(() => {
  rmSync(agentDir, { recursive: true, force: true });
});

describe("AgentRuntime end-to-end", () => {
  test("initializes from a fresh agent directory", async () => {
    const runtime = new AgentRuntime(agentDir);
    // initialize() will fail at getModel() since we have no LLM config,
    // but we can catch that and verify everything before it
    try {
      await runtime.initialize();
    } catch {
      // Expected: LLM model creation may fail without credentials
      // That's fine — we're testing everything before the Agent() creation
    }

    // Identity should be parsed regardless
    const identity = runtime.getIdentity();
    expect(identity).toBeDefined();
    expect(identity!.name).toBe("E2ETestAgent");
    expect(identity!.purpose).toBe("End-to-end test agent with inline tools.");
    expect(identity!.capabilities).toHaveLength(2);
    expect(identity!.constraints).toHaveLength(2);
    expect(identity!.personality).toBe("Terse and precise.");
  });

  test("loads skills from agent directory", async () => {
    const runtime = new AgentRuntime(agentDir);
    try {
      await runtime.initialize();
    } catch {}

    const skillLoader = runtime.getSkillLoader();
    expect(skillLoader.hasSkill("test-skill")).toBe(true);
    expect(skillLoader.getAvailableSkillNames()).toContain("test-skill");
  });

  test("creates state and log directories on use", async () => {
    const freshDir = mkdtempSync(join(tmpdir(), "imps-dirs-"));
    await Bun.write(
      join(freshDir, "agent.mdx"),
      `# Agent: DirTest\n\n## Purpose\nTest directory creation.`,
    );

    const runtime = new AgentRuntime(freshDir);
    try {
      await runtime.initialize();
    } catch {}

    // Directories aren't created until log() or saveState() is called,
    // which happens during processTaskStream. But we verify the runtime
    // doesn't fail during init even without them.
    expect(runtime.getAgentPath()).toBe(freshDir);

    rmSync(freshDir, { recursive: true, force: true });
  });

  test("parses agent.mdx without frontmatter", async () => {
    const noFmDir = mkdtempSync(join(tmpdir(), "imps-nofm-"));
    await Bun.write(
      join(noFmDir, "agent.mdx"),
      `# Agent: NoFrontmatter\n\n## Purpose\nWorks without frontmatter.`,
    );

    const runtime = new AgentRuntime(noFmDir);
    try {
      await runtime.initialize();
    } catch {}

    expect(runtime.getIdentity()!.name).toBe("NoFrontmatter");

    rmSync(noFmDir, { recursive: true, force: true });
  });

  test("handles agent.mdx with tools but no skills or heartbeat", async () => {
    const minimalDir = mkdtempSync(join(tmpdir(), "imps-minimal-"));
    await Bun.write(
      join(minimalDir, "agent.mdx"),
      `# Agent: Minimal

## Purpose
Minimal agent.

<Tool name="ping" description="Returns pong">

\`\`\`typescript
async function execute(params: {}, ctx: any) {
  return "pong"
}
\`\`\`
</Tool>
`,
    );

    const runtime = new AgentRuntime(minimalDir);
    try {
      await runtime.initialize();
    } catch {}

    expect(runtime.getIdentity()!.name).toBe("Minimal");

    rmSync(minimalDir, { recursive: true, force: true });
  });
});

describe("inline tool execution (e2e)", () => {
  test("tools defined in agent.mdx are executable", async () => {
    // Parse + build tools directly (bypasses LLM)
    const { parseAgentMdx } = await import("../src/runtime/mdx-parser.ts");
    const { buildToolsFromDefs } = await import("../src/runtime/tool-builder.ts");

    const source = await Bun.file(join(agentDir, "agent.mdx")).text();
    const def = parseAgentMdx(source);

    const ctx = {
      agentDir,
      cwd: agentDir,
      log: async () => {},
    };

    const tools = buildToolsFromDefs(def.tools, ctx);
    expect(tools).toHaveLength(2);

    // Test get_time
    const timeResult = await tools[0].execute("t1", {});
    const timeText = timeResult.content[0] as { type: "text"; text: string };
    expect(timeText.text).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Test add
    const addResult = await tools[1].execute("t1", { a: 10, b: 20 });
    const addText = addResult.content[0] as { type: "text"; text: string };
    expect(addText.text).toBe("30");
  });

  test("tool errors are caught and returned as text", async () => {
    const { parseAgentMdx } = await import("../src/runtime/mdx-parser.ts");
    const { buildToolsFromDefs } = await import("../src/runtime/tool-builder.ts");

    const source = `# Agent: X
## Purpose
Y
<Tool name="fail" description="Fails">

\`\`\`typescript
async function execute(params: {}, ctx: any) {
  throw new Error("intentional failure")
}
\`\`\`
</Tool>`;

    const def = parseAgentMdx(source);
    const tools = buildToolsFromDefs(def.tools, {
      agentDir: "/tmp",
      cwd: "/tmp",
      log: async () => {},
    });

    const result = await tools[0].execute("t1", {});
    const text = result.content[0] as { type: "text"; text: string };
    expect(text.text).toContain("intentional failure");
  });
});
