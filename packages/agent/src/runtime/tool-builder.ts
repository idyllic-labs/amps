/**
 * Tool Builder
 * Converts ParsedToolDef[] into AgentTool[] for use with pi-agent-core.
 * Transpiles TypeScript tool code via Bun.Transpiler, builds TypeBox schemas
 * from param definitions, and wraps execution in error-safe handlers.
 */

import { Type, type TObject, type TProperties } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolContext } from "../types/index.ts";
import type { ParsedToolDef } from "./mdx-parser.ts";

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Build a TypeBox schema from parsed param definitions.
 */
function buildSchema(params: ParsedToolDef["params"]): TObject {
  const properties: TProperties = {};

  for (const param of params) {
    let schema;
    switch (param.type) {
      case "number":
        schema = Type.Number({ description: param.description });
        break;
      case "boolean":
        schema = Type.Boolean({ description: param.description });
        break;
      default:
        schema = Type.String({ description: param.description });
        break;
    }
    properties[param.name] = param.required ? schema : Type.Optional(schema);
  }

  return Type.Object(properties);
}

/**
 * Build AgentTool instances from parsed tool definitions.
 */
export function buildToolsFromDefs(defs: ParsedToolDef[], ctx: ToolContext): AgentTool<any>[] {
  return defs.map((def) => buildSingleTool(def, ctx));
}

function buildSingleTool(def: ParsedToolDef, ctx: ToolContext): AgentTool<any> {
  const schema = buildSchema(def.params);

  // Transpile TS -> JS
  const jsCode = transpiler.transformSync(def.code);

  // Create the execute function from transpiled code
  // The code must define `async function execute(params, ctx) { ... }`
  // We append a call to return its result
  const executeFn = new Function("params", "ctx", jsCode + "\nreturn execute(params, ctx);") as (
    params: any,
    ctx: ToolContext,
  ) => Promise<string>;

  return {
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: schema,
    async execute(_toolCallId: string, params: any): Promise<AgentToolResult<{}>> {
      try {
        const result = await executeFn(params, ctx);
        return {
          content: [{ type: "text", text: String(result) }],
          details: {},
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          details: {},
        };
      }
    },
  };
}
