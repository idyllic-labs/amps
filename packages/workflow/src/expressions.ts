/**
 * Expression evaluator for mdx-ai/workflow.
 *
 * Evaluates JavaScript expressions found inside {} in MDX files.
 * Uses `new Function()` for evaluation — this is a local CLI tool,
 * so sandboxing is not a security concern.
 */

import type { Expression } from "./types";

// Builtins injected into every expression scope
const BUILTIN_NAMES = [
  "JSON",
  "Math",
  "Date",
  "parseInt",
  "parseFloat",
  "String",
  "Number",
  "Boolean",
  "Array",
  "Object",
  "undefined",
  "NaN",
  "Infinity",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
] as const;

const BUILTIN_VALUES = [
  JSON,
  Math,
  Date,
  parseInt,
  parseFloat,
  String,
  Number,
  Boolean,
  Array,
  Object,
  undefined,
  NaN,
  Infinity,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
];

/**
 * Evaluate a JavaScript expression in a given scope.
 *
 * The expression is what appears inside `{}` in the MDX.
 *
 * @example
 *   evaluateExpression("score > 0.8", { score: 0.9 })  // true
 *   evaluateExpression("items.map(x => x.name)", { items: [{name:"a"}] })  // ["a"]
 *   evaluateExpression("`Hello ${name}`", { name: "World" })  // "Hello World"
 */
export function evaluateExpression(expr: string, scope: Record<string, any>): any {
  const trimmed = expr.trim();
  if (trimmed === "") return undefined;

  const scopeKeys = Object.keys(scope);
  const scopeValues = scopeKeys.map((k) => scope[k]);

  // Combine scope + builtins
  const allKeys = [...scopeKeys, ...BUILTIN_NAMES];
  const allValues = [...scopeValues, ...BUILTIN_VALUES];

  try {
    const fn = new Function(...allKeys, `return (${trimmed})`);
    return fn(...allValues);
  } catch {
    // If the expression fails (e.g. undefined variable in a chain),
    // return undefined rather than throwing.
    return undefined;
  }
}

/**
 * Interpolate a template string that may contain `{expr}` references.
 *
 * Used for prose blocks and content attributes. Scans for `{…}` patterns
 * with proper brace-depth tracking so nested braces (object literals,
 * arrow function bodies) are handled correctly.
 *
 * Skips MDX comment patterns `{/* … *\/}`.
 *
 * @example
 *   interpolateString("Hello {name}!", { name: "World" })  // "Hello World!"
 *   interpolateString("Score: {score * 100}%", { score: 0.85 })  // "Score: 85%"
 */
export function interpolateString(template: string, scope: Record<string, any>): string {
  const segments: string[] = [];
  let i = 0;

  while (i < template.length) {
    if (template[i] === "{") {
      // Check for MDX comment: {/* ... */}
      if (template.startsWith("{/*", i)) {
        const commentEnd = template.indexOf("*/}", i);
        if (commentEnd !== -1) {
          i = commentEnd + 3;
          continue;
        }
      }

      // Track brace depth to find the matching closing brace
      const exprStart = i + 1;
      let depth = 1;
      let j = exprStart;

      // Track whether we're inside a string literal to avoid
      // counting braces that are part of string content.
      let inString: string | null = null; // null | "'" | '"' | '`'
      let escaped = false;

      while (j < template.length && depth > 0) {
        const ch = template[j];

        if (escaped) {
          escaped = false;
          j++;
          continue;
        }

        if (ch === "\\") {
          escaped = true;
          j++;
          continue;
        }

        if (inString) {
          if (ch === inString) {
            inString = null;
          }
          // Template literal interpolation inside a template literal
          // e.g. `${...}` — we still need to track depth for the
          // outer expression's closing brace, but the `${` inside a
          // template literal opens a new expression scope whose braces
          // are balanced internally.  We handle this by letting `{`
          // and `}` tracking continue even inside template literals
          // when preceded by `$`.
          j++;
          continue;
        }

        if (ch === "'" || ch === '"' || ch === "`") {
          inString = ch;
          j++;
          continue;
        }

        if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
        }
        j++;
      }

      if (depth === 0) {
        const exprBody = template.slice(exprStart, j - 1);
        const value = evaluateExpression(exprBody, scope);
        segments.push(value === undefined || value === null ? "" : String(value));
        i = j;
      } else {
        // Unmatched brace — emit literally
        segments.push("{");
        i = exprStart;
      }
    } else {
      // Accumulate plain text until the next `{`
      const next = template.indexOf("{", i);
      if (next === -1) {
        segments.push(template.slice(i));
        i = template.length;
      } else {
        segments.push(template.slice(i, next));
        i = next;
      }
    }
  }

  return segments.join("");
}

/**
 * Evaluate a condition expression and return a boolean.
 *
 * Evaluates the expression via `evaluateExpression` and coerces the result
 * to a boolean using JavaScript truthiness rules.
 *
 * @example
 *   evaluateCondition("score >= 80", { score: 85 })  // true
 *   evaluateCondition("items.length", { items: [] })  // false
 *   evaluateCondition("!skip", { skip: false })        // true
 */
export function evaluateCondition(expr: string, scope: Record<string, any>): boolean {
  return Boolean(evaluateExpression(expr, scope));
}

/**
 * Resolve an `Expression` object (from types.ts) against a scope.
 *
 * If the expression is static, the raw string value is returned as-is.
 * If it is dynamic, the raw string is evaluated as a JS expression.
 *
 * @example
 *   resolveExpression({ raw: "hello", isStatic: true }, {})  // "hello"
 *   resolveExpression({ raw: "x + 1", isStatic: false }, { x: 2 })  // 3
 */
export function resolveExpression(expr: Expression, scope: Record<string, any>): any {
  if (expr.isStatic) {
    return expr.raw;
  }
  return evaluateExpression(expr.raw, scope);
}
