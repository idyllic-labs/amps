/**
 * MDX Workflow Parser
 * Parses .mdx workflow files into WorkflowDefinition objects.
 * Uses direct regex/manual parsing — no @mdx-js/mdx dependency.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type {
  Expression,
  InputType,
  InputDef,
  FieldDef,
  ProseNode,
  GenerationNode,
  StructuredNode,
  WebSearchNode,
  WebFetchNode,
  LoopNode,
  IfNode,
  SetNode,
  LogNode,
  CommentNode,
  FlowNode,
  PromptNode,
  SelectNode,
  ConfirmNode,
  WorkflowNode,
  WorkflowDefinition,
  ValidationError,
} from "./types";

// ─── Frontmatter Parsing ───────────────────────────────────────────────────

/**
 * Split source into frontmatter YAML string and body MDX string.
 * Returns [yaml, body]. If no frontmatter, yaml is empty.
 */
function splitFrontmatter(source: string): [string, string] {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return ["", source];
  return [match[1], match[2]];
}

/**
 * Minimal YAML-subset parser for frontmatter.
 * Handles: scalars, lists (both inline and dash-style), nested objects via indentation.
 */
function parseYamlValue(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "~" || trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  // Strip quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  // Inline list
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => parseYamlValue(s));
  }
  return trimmed;
}

interface YamlLine {
  indent: number;
  key?: string;
  value?: string;
  isDash: boolean;
  dashValue?: string;
  raw: string;
}

function tokenizeYaml(yaml: string): YamlLine[] {
  const lines: YamlLine[] = [];
  for (const raw of yaml.split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indent = raw.search(/\S/);
    const content = raw.trim();
    if (content.startsWith("- ")) {
      lines.push({ indent, isDash: true, dashValue: content.slice(2).trim(), raw });
    } else {
      const colonIdx = content.indexOf(":");
      if (colonIdx !== -1) {
        const key = content.slice(0, colonIdx).trim();
        const value = content.slice(colonIdx + 1).trim();
        lines.push({ indent, key, value: value || undefined, isDash: false, raw });
      } else {
        lines.push({ indent, isDash: false, raw, value: content });
      }
    }
  }
  return lines;
}

function parseYamlBlock(tokens: YamlLine[], start: number, parentIndent: number): [Record<string, any>, number] {
  const result: Record<string, any> = {};
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.indent <= parentIndent && i > start) break;

    if (tok.key !== undefined) {
      if (tok.value !== undefined && tok.value !== "") {
        result[tok.key] = parseYamlValue(tok.value);
        i++;
      } else {
        // Check what follows
        if (i + 1 < tokens.length && tokens[i + 1].indent > tok.indent) {
          if (tokens[i + 1].isDash) {
            // Dash list
            const arr: any[] = [];
            let j = i + 1;
            while (j < tokens.length && tokens[j].indent > tok.indent) {
              if (tokens[j].isDash) {
                arr.push(parseYamlValue(tokens[j].dashValue!));
              }
              j++;
            }
            result[tok.key] = arr;
            i = j;
          } else {
            // Nested object
            const [nested, nextIdx] = parseYamlBlock(tokens, i + 1, tok.indent);
            result[tok.key] = nested;
            i = nextIdx;
          }
        } else {
          result[tok.key] = null;
          i++;
        }
      }
    } else {
      i++;
    }
  }
  return [result, i];
}

function parseYaml(yaml: string): Record<string, any> {
  if (!yaml.trim()) return {};
  const tokens = tokenizeYaml(yaml);
  const [result] = parseYamlBlock(tokens, 0, -1);
  return result;
}

// ─── Input Type Parsing ────────────────────────────────────────────────────

/**
 * Parse an input type declaration like "text", "number = 2", "list<text>"
 */
function parseInputTypeDecl(raw: string): { type: InputType; elementType?: InputType; defaultValue?: any } {
  const trimmed = raw.trim();

  // Check for default: "type = default"
  const eqIdx = trimmed.indexOf("=");
  let typeStr = trimmed;
  let defaultValue: any = undefined;
  if (eqIdx !== -1) {
    typeStr = trimmed.slice(0, eqIdx).trim();
    defaultValue = parseYamlValue(trimmed.slice(eqIdx + 1));
  }

  // Check for list<T>
  const listMatch = typeStr.match(/^list<(\w+)>$/);
  if (listMatch) {
    return { type: "list", elementType: listMatch[1] as InputType, defaultValue };
  }

  return { type: typeStr as InputType, defaultValue };
}

/**
 * Parse the inputs section of frontmatter into InputDef[]
 */
function parseInputs(inputsObj: Record<string, any> | undefined): InputDef[] {
  if (!inputsObj || typeof inputsObj !== "object") return [];
  const defs: InputDef[] = [];
  for (const [name, rawValue] of Object.entries(inputsObj)) {
    if (typeof rawValue === "string") {
      const { type, elementType, defaultValue } = parseInputTypeDecl(rawValue);
      defs.push({
        name,
        type,
        required: defaultValue === undefined,
        default: defaultValue,
        elementType,
      });
    } else if (typeof rawValue === "object" && rawValue !== null) {
      // Nested object type
      const children: Record<string, InputDef> = {};
      for (const [childName, childRaw] of Object.entries(rawValue)) {
        if (typeof childRaw === "string") {
          const { type, elementType, defaultValue } = parseInputTypeDecl(childRaw);
          children[childName] = {
            name: childName,
            type,
            required: defaultValue === undefined,
            default: defaultValue,
            elementType,
          };
        }
      }
      defs.push({
        name,
        type: "object",
        required: true,
        children,
      });
    }
  }
  return defs;
}

/**
 * Parse the outputs section of frontmatter
 */
function parseOutputs(outputsVal: any): string[] | undefined {
  if (!outputsVal) return undefined;
  if (Array.isArray(outputsVal)) return outputsVal.map(String);
  return undefined;
}

// ─── Expression Parsing ────────────────────────────────────────────────────

function makeExpression(raw: string): Expression {
  return { raw, isStatic: false };
}

function makeStaticExpression(raw: string): Expression {
  return { raw, isStatic: true };
}

// ─── Prop Parsing ──────────────────────────────────────────────────────────

/**
 * Find the matching closing brace for an opening `{` at position `start`.
 * Handles nested braces, strings, template literals.
 */
function findMatchingBrace(str: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < str.length) {
    const ch = str[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      // Skip string content
      const quote = ch;
      i++;
      while (i < str.length) {
        if (str[i] === "\\") {
          i++; // skip escaped char
        } else if (str[i] === quote) {
          break;
        } else if (quote === "`" && str[i] === "$" && str[i + 1] === "{") {
          // template literal expression — recurse
          const end = findMatchingBrace(str, i + 1);
          if (end === -1) return -1;
          i = end;
        }
        i++;
      }
    }
    i++;
  }
  return -1;
}

interface ParsedProps {
  [key: string]: Expression;
}

/**
 * Parse JSX-like props from a tag attribute string.
 * e.g. `name="value" temperature={0.7} inputs={{ key: val }}`
 */
function parseProps(attrStr: string): ParsedProps {
  const props: ParsedProps = {};
  let i = 0;
  const s = attrStr.trim();

  while (i < s.length) {
    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    // Read key
    const keyStart = i;
    while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) i++;
    const key = s.slice(keyStart, i);
    if (!key) { i++; continue; }

    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) i++;

    // Expect '='
    if (s[i] !== "=") {
      // Boolean prop (no value) — skip for now
      props[key] = makeStaticExpression("true");
      continue;
    }
    i++; // skip '='

    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) i++;

    if (s[i] === '"') {
      // String literal
      i++; // skip opening quote
      let val = "";
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") {
          i++;
          val += s[i] || "";
        } else {
          val += s[i];
        }
        i++;
      }
      i++; // skip closing quote
      props[key] = makeStaticExpression(val);
    } else if (s[i] === "{") {
      // Expression
      const end = findMatchingBrace(s, i);
      if (end === -1) {
        // Malformed — take rest
        props[key] = makeExpression(s.slice(i + 1));
        break;
      }
      const inner = s.slice(i + 1, end).trim();
      // Check if it's a template literal or other expression
      props[key] = makeExpression(inner);
      i = end + 1;
    } else {
      // Bare value — read until whitespace
      const valStart = i;
      while (i < s.length && !/\s/.test(s[i])) i++;
      props[key] = makeStaticExpression(s.slice(valStart, i));
    }
  }

  return props;
}

// ─── Tag Parsing Utilities ─────────────────────────────────────────────────

/** Known component names */
const KNOWN_COMPONENTS = new Set([
  "Generation",
  "Structured",
  "WebSearch",
  "WebFetch",
  "Loop",
  "If",
  "Else",
  "Set",
  "Log",
  "Comment",
  "Flow",
  "Field",
  "Prompt",
  "Select",
  "Confirm",
]);

/**
 * Find the closing tag for a given component name, starting at `startIdx`
 * in the source. Handles nested same-name tags.
 */
function findClosingTag(source: string, tagName: string, startIdx: number): number {
  let depth = 1;
  let i = startIdx;
  while (i < source.length) {
    // Check for self-closing tag of same name
    const selfCloseMatch = matchSelfClosingTag(source, i);
    if (selfCloseMatch && selfCloseMatch.name === tagName) {
      i = selfCloseMatch.end;
      continue;
    }
    // Check for opening tag of same name
    const openMatch = matchOpeningTag(source, i);
    if (openMatch && openMatch.name === tagName) {
      depth++;
      i = openMatch.end;
      continue;
    }
    // Check for closing tag
    const closeRegex = new RegExp(`<\\/${tagName}\\s*>`);
    const closeMatch = source.slice(i).match(closeRegex);
    if (closeMatch && closeMatch.index === 0) {
      depth--;
      if (depth === 0) {
        return i;
      }
      i += closeMatch[0].length;
      continue;
    }
    i++;
  }
  return -1;
}

interface TagMatch {
  name: string;
  attrs: string;
  end: number; // index after the tag in source
  start: number; // index of '<' in source
}

function matchSelfClosingTag(source: string, pos: number): TagMatch | null {
  if (source[pos] !== "<") return null;
  const slice = source.slice(pos);
  if (slice[1] === "/") return null;

  const nameMatch = slice.match(/^<([A-Z]\w*)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  let i = nameMatch[0].length;
  while (i < slice.length) {
    if (slice[i] === "{") {
      const end = findMatchingBrace(slice, i);
      if (end === -1) return null;
      i = end + 1;
    } else if (slice[i] === '"') {
      // Skip string
      i++;
      while (i < slice.length && slice[i] !== '"') {
        if (slice[i] === "\\") i++;
        i++;
      }
      i++; // skip closing quote
    } else if (slice[i] === "/" && slice[i + 1] === ">") {
      const attrs = slice.slice(nameMatch[0].length, i).trim();
      return {
        name,
        attrs,
        start: pos,
        end: pos + i + 2,
      };
    } else if (slice[i] === ">") {
      // This is an opening tag, not self-closing
      return null;
    } else if (slice[i] === "<") {
      // Hit another tag — not a self-closing tag
      return null;
    } else {
      i++;
    }
  }
  return null;
}

function matchOpeningTag(source: string, pos: number): TagMatch | null {
  if (source[pos] !== "<") return null;
  const slice = source.slice(pos);
  // Must NOT be a closing tag or self-closing
  if (slice[1] === "/") return null;

  // We need to match `<Name attrs>` but attrs can contain `{}` with nested content.
  const nameMatch = slice.match(/^<([A-Z]\w*)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  // Walk forward past the tag name to find the closing `>`
  let i = nameMatch[0].length;
  while (i < slice.length) {
    if (slice[i] === "{") {
      const end = findMatchingBrace(slice, i);
      if (end === -1) return null;
      i = end + 1;
    } else if (slice[i] === "/" && slice[i + 1] === ">") {
      // Actually self-closing — return null so matchSelfClosingTag handles it
      return null;
    } else if (slice[i] === ">") {
      const attrs = slice.slice(nameMatch[0].length, i).trim();
      return {
        name,
        attrs,
        start: pos,
        end: pos + i + 1,
      };
    } else {
      i++;
    }
  }
  return null;
}

// ─── MDX Content Parser ────────────────────────────────────────────────────

/**
 * Parse MDX body content into WorkflowNode[].
 * Walks through the source, identifying components, comments, and prose.
 */
function parseNodes(source: string): WorkflowNode[] {
  const nodes: WorkflowNode[] = [];
  let i = 0;
  let proseBuffer = "";

  function flushProse() {
    const trimmed = proseBuffer.trim();
    if (trimmed) {
      nodes.push({ kind: "prose", content: trimmed } as ProseNode);
    }
    proseBuffer = "";
  }

  while (i < source.length) {
    // Check for MDX comment: {/* ... */}
    if (source[i] === "{" && source.slice(i, i + 3) === "{/*") {
      flushProse();
      const endComment = source.indexOf("*/}", i + 3);
      if (endComment === -1) {
        // Unterminated comment — skip rest
        break;
      }
      nodes.push({ kind: "comment" } as CommentNode);
      i = endComment + 3;
      continue;
    }

    // Check for self-closing tag
    const selfClose = matchSelfClosingTag(source, i);
    if (selfClose && isComponentName(selfClose.name)) {
      flushProse();
      const node = buildNodeFromSelfClosing(selfClose);
      if (node) nodes.push(node);
      i = selfClose.end;
      continue;
    }

    // Check for opening tag
    const open = matchOpeningTag(source, i);
    if (open && isComponentName(open.name)) {
      flushProse();
      const closeIdx = findClosingTag(source, open.name, open.end);
      if (closeIdx === -1) {
        throw new ParseError(`Unclosed <${open.name}> tag`, lineAt(source, open.start));
      }
      const innerContent = source.slice(open.end, closeIdx);
      const closeTagEnd = closeIdx + `</${open.name}>`.length;

      const node = buildNodeFromBlock(open, innerContent);
      if (node) {
        // If this is an If node, look ahead for an <Else> block
        if (node.kind === "if") {
          const elseResult = tryParseElse(source, closeTagEnd);
          if (elseResult) {
            node.elseChildren = elseResult.children;
            i = elseResult.end;
            nodes.push(node);
            continue;
          }
        }
        nodes.push(node);
      }
      i = closeTagEnd;
      continue;
    }

    // Check for broken/unclosed component tag: `<ComponentName` with no closing `>` or `/>`
    if (source[i] === "<") {
      const brokenMatch = source.slice(i).match(/^<([A-Z]\w*)/);
      if (brokenMatch && isComponentName(brokenMatch[1])) {
        throw new ParseError(
          `Expected closing tag or self-closing for <${brokenMatch[1]}>`,
          lineAt(source, i),
        );
      }

      // Check for closing tag that isn't matched (shouldn't happen if well-formed)
      if (source[i + 1] === "/") {
        // Skip stray closing tags
        const endBracket = source.indexOf(">", i);
        if (endBracket !== -1) {
          i = endBracket + 1;
          continue;
        }
      }
    }

    // Accumulate prose
    proseBuffer += source[i];
    i++;
  }

  flushProse();
  return nodes;
}

function isComponentName(name: string): boolean {
  // Any PascalCase tag is a component
  return /^[A-Z]/.test(name);
}

function lineAt(source: string, pos: number): number {
  return source.slice(0, pos).split("\n").length;
}

// ─── Node Builders ─────────────────────────────────────────────────────────

function buildNodeFromSelfClosing(tag: TagMatch): WorkflowNode | null {
  const props = parseProps(tag.attrs);

  switch (tag.name) {
    case "Generation":
      return buildGenerationNode(props);
    case "WebSearch":
      return buildWebSearchNode(props);
    case "WebFetch":
      return buildWebFetchNode(props);
    case "Set":
      return buildSetNode(props);
    case "Flow":
      return buildFlowNode(props);
    case "Prompt":
      return buildPromptNode(props);
    case "Select":
      return buildSelectNode(props);
    case "Confirm":
      return buildConfirmNode(props);
    case "Field":
      // Field nodes only appear inside Structured — shouldn't be top-level
      return null;
    case "Log":
      return buildLogNode(props, "");
    case "Comment":
      return { kind: "comment" } as CommentNode;
    default:
      // Unknown component — still record it as a prose node with the raw tag
      // (validation will catch it later)
      return { kind: "prose", content: `<${tag.name} />` } as ProseNode;
  }
}

function buildNodeFromBlock(tag: TagMatch, inner: string): WorkflowNode | null {
  const props = parseProps(tag.attrs);

  switch (tag.name) {
    case "Structured":
      return buildStructuredNode(props, inner);
    case "Loop":
      return buildLoopNode(props, inner);
    case "If":
      return buildIfNode(props, inner);
    case "Else":
      // Else is handled by tryParseElse; should not appear standalone
      return null;
    case "Log":
      return buildLogNode(props, inner.trim());
    case "Comment":
      return { kind: "comment" } as CommentNode;
    case "Generation":
      // Generation with body — still treat as generation (body is part of context)
      return buildGenerationNode(props);
    default:
      return { kind: "prose", content: `<${tag.name}>${inner}</${tag.name}>` } as ProseNode;
  }
}

function buildGenerationNode(props: ParsedProps): GenerationNode {
  const node: GenerationNode = {
    kind: "generation",
    name: props.name?.raw ?? "",
  };
  if (props.model) node.model = props.model.raw;
  if (props.temperature) node.temperature = Number(props.temperature.raw);
  if (props.maxTokens) node.maxTokens = Number(props.maxTokens.raw);
  if (props.stop) {
    // stop is an expression like `["##", "END"]`
    try {
      node.stop = JSON.parse(props.stop.raw.replace(/'/g, '"'));
    } catch {
      // Keep as expression — runtime will evaluate
    }
  }
  return node;
}

function buildWebSearchNode(props: ParsedProps): WebSearchNode {
  return {
    kind: "websearch",
    name: props.name?.raw ?? "",
    query: props.query ?? makeStaticExpression(""),
    maxResults: props.maxResults ? Number(props.maxResults.raw) : undefined,
    provider: props.provider?.raw as "exa" | "serp" | undefined,
  };
}

function buildWebFetchNode(props: ParsedProps): WebFetchNode {
  return {
    kind: "webfetch",
    name: props.name?.raw ?? "",
    url: props.url ?? makeStaticExpression(""),
    maxTokens: props.maxTokens ? Number(props.maxTokens.raw) : undefined,
    selector: props.selector?.raw,
  };
}

function buildSetNode(props: ParsedProps): SetNode {
  return {
    kind: "set",
    name: props.name?.raw ?? "",
    value: props.value ?? makeExpression("undefined"),
  };
}

function buildFlowNode(props: ParsedProps): FlowNode {
  const node: FlowNode = {
    kind: "flow",
    name: props.name?.raw ?? "",
    src: props.src?.raw ?? "",
  };
  if (props.inputs) {
    // The inputs prop is an expression like `{ question: item.question, depth: depth - 1 }`
    // We store the raw expression; runtime will evaluate it as an object
    node.inputs = parseObjectExpression(props.inputs.raw);
  }
  return node;
}

/**
 * Parse an object expression like `{ question: item.question, depth: depth - 1 }` into
 * Record<string, Expression>.
 */
function parseObjectExpression(raw: string): Record<string, Expression> {
  const result: Record<string, Expression> = {};
  let inner = raw.trim();
  // Strip outer braces if present
  if (inner.startsWith("{") && inner.endsWith("}")) {
    inner = inner.slice(1, -1).trim();
  }

  // Split on commas — but must be careful of nested expressions
  const entries = splitOnTopLevelCommas(inner);
  for (const entry of entries) {
    const colonIdx = entry.indexOf(":");
    if (colonIdx === -1) continue;
    const key = entry.slice(0, colonIdx).trim();
    const value = entry.slice(colonIdx + 1).trim();
    result[key] = makeExpression(value);
  }
  return result;
}

function splitOnTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function buildPromptNode(props: ParsedProps): PromptNode {
  const node: PromptNode = {
    kind: "prompt",
    name: props.name?.raw ?? "",
    message: props.message ?? makeStaticExpression(""),
  };
  if (props.default) node.default = props.default;
  if (props.type) node.inputType = props.type.raw as "text" | "number";
  return node;
}

function buildSelectNode(props: ParsedProps): SelectNode {
  const node: SelectNode = {
    kind: "select",
    name: props.name?.raw ?? "",
    message: props.message ?? makeStaticExpression(""),
    options: props.options ?? makeExpression("[]"),
  };
  if (props.labelKey) node.labelKey = props.labelKey.raw;
  if (props.valueKey) node.valueKey = props.valueKey.raw;
  return node;
}

function buildConfirmNode(props: ParsedProps): ConfirmNode {
  const node: ConfirmNode = {
    kind: "confirm",
    name: props.name?.raw ?? "",
    message: props.message ?? makeStaticExpression(""),
  };
  if (props.default) node.default = props.default;
  return node;
}

function buildLogNode(props: ParsedProps, content: string): LogNode {
  return {
    kind: "log",
    level: (props.level?.raw as "info" | "debug" | "warn") ?? "info",
    content,
  };
}

function buildStructuredNode(props: ParsedProps, inner: string): StructuredNode {
  return {
    kind: "structured",
    name: props.name?.raw ?? "",
    model: props.model?.raw,
    fields: parseFieldChildren(inner),
  };
}

/**
 * Parse <Field .../> children from the inner content of a <Structured> block.
 * Handles nested fields (for list and object types).
 */
function parseFieldChildren(source: string): FieldDef[] {
  const fields: FieldDef[] = [];
  let i = 0;

  while (i < source.length) {
    // Self-closing <Field ... />
    const selfClose = matchSelfClosingTag(source, i);
    if (selfClose && selfClose.name === "Field") {
      const props = parseProps(selfClose.attrs);
      fields.push({
        name: props.name?.raw,
        type: (props.type?.raw ?? "text") as FieldDef["type"],
        description: props.description?.raw,
      });
      i = selfClose.end;
      continue;
    }

    // Block <Field ...>...</Field> (for nested list/object fields)
    const open = matchOpeningTag(source, i);
    if (open && open.name === "Field") {
      const closeIdx = findClosingTag(source, "Field", open.end);
      if (closeIdx !== -1) {
        const inner = source.slice(open.end, closeIdx);
        const props = parseProps(open.attrs);
        const children = parseFieldChildren(inner);
        fields.push({
          name: props.name?.raw,
          type: (props.type?.raw ?? "text") as FieldDef["type"],
          description: props.description?.raw,
          children: children.length > 0 ? children : undefined,
        });
        i = closeIdx + "</Field>".length;
        continue;
      }
    }

    i++;
  }

  return fields;
}

function buildLoopNode(props: ParsedProps, inner: string): LoopNode {
  const node: LoopNode = {
    kind: "loop",
    name: props.name?.raw ?? "",
    children: parseNodes(inner),
  };
  if (props.over) node.over = props.over;
  if (props.count) node.count = props.count;
  return node;
}

function buildIfNode(props: ParsedProps, inner: string): IfNode {
  return {
    kind: "if",
    condition: props.condition ?? makeExpression("false"),
    children: parseNodes(inner),
  };
}

/**
 * Look ahead from `pos` for an <Else>...</Else> block.
 * Skips whitespace/comments between </If> and <Else>.
 */
function tryParseElse(source: string, pos: number): { children: WorkflowNode[]; end: number } | null {
  let i = pos;
  // Skip whitespace and MDX comments
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    if (source.slice(i, i + 3) === "{/*") {
      const endComment = source.indexOf("*/}", i + 3);
      if (endComment !== -1) {
        i = endComment + 3;
        continue;
      }
    }
    break;
  }

  // Check for self-closing <Else />
  const selfClose = matchSelfClosingTag(source, i);
  if (selfClose && selfClose.name === "Else") {
    // Self-closing else — no children
    return { children: [], end: selfClose.end };
  }

  // Check for <Else>
  const open = matchOpeningTag(source, i);
  if (!open || open.name !== "Else") return null;

  const closeIdx = findClosingTag(source, "Else", open.end);
  if (closeIdx === -1) return null;

  const inner = source.slice(open.end, closeIdx);
  const children = parseNodes(inner);
  const end = closeIdx + "</Else>".length;
  return { children, end };
}

// ─── Parse Error ───────────────────────────────────────────────────────────

class ParseError extends Error {
  line?: number;
  column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = "ParseError";
    this.line = line;
    this.column = column;
  }
}

// ─── Main Exports ──────────────────────────────────────────────────────────

/**
 * Parse an MDX workflow file into a WorkflowDefinition.
 */
export function parseWorkflow(filePath: string): WorkflowDefinition {
  const source = readFileSync(filePath, "utf-8");
  const [yaml, body] = splitFrontmatter(source);
  const frontmatter = parseYaml(yaml);

  const nodes = parseNodes(body);

  return {
    name: (frontmatter.name as string) ?? "",
    description: frontmatter.description as string | undefined,
    inputs: parseInputs(frontmatter.inputs as Record<string, any> | undefined),
    outputs: parseOutputs(frontmatter.outputs),
    nodes,
  };
}

// ─── Validation ────────────────────────────────────────────────────────────

const VALID_FIELD_TYPES = new Set(["text", "number", "boolean", "list", "object"]);

/**
 * Validate a parsed WorkflowDefinition for common errors.
 */
export function validateWorkflow(
  def: WorkflowDefinition,
  /** Base directory for resolving relative paths (e.g., for Flow src) */
  basePath?: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  function validateNodes(nodes: WorkflowNode[]) {
    for (const node of nodes) {
      switch (node.kind) {
        case "generation":
          if (!node.name) errors.push({ message: "Generation node is missing required 'name' prop" });
          break;
        case "structured":
          if (!node.name) errors.push({ message: "Structured node is missing required 'name' prop" });
          validateFields(node.fields);
          break;
        case "websearch":
          if (!node.name) errors.push({ message: "WebSearch node is missing required 'name' prop" });
          break;
        case "webfetch":
          if (!node.name) errors.push({ message: "WebFetch node is missing required 'name' prop" });
          break;
        case "loop":
          if (!node.name) errors.push({ message: "Loop node is missing required 'name' prop" });
          validateNodes(node.children);
          break;
        case "if":
          validateNodes(node.children);
          if (node.elseChildren) validateNodes(node.elseChildren);
          break;
        case "set":
          if (!node.name) errors.push({ message: "Set node is missing required 'name' prop" });
          break;
        case "flow":
          if (!node.name) errors.push({ message: "Flow node is missing required 'name' prop" });
          if (!node.src) errors.push({ message: "Flow node is missing required 'src' prop" });
          else if (basePath) {
            const resolved = resolve(basePath, node.src);
            if (!existsSync(resolved)) {
              errors.push({ message: `Flow src file not found: ${node.src}` });
            }
          }
          break;
        case "prompt":
          if (!node.name) errors.push({ message: "Prompt node is missing required 'name' prop" });
          if (!node.message.raw) errors.push({ message: "Prompt node is missing required 'message' prop" });
          break;
        case "select":
          if (!node.name) errors.push({ message: "Select node is missing required 'name' prop" });
          if (!node.message.raw) errors.push({ message: "Select node is missing required 'message' prop" });
          break;
        case "confirm":
          if (!node.name) errors.push({ message: "Confirm node is missing required 'name' prop" });
          if (!node.message.raw) errors.push({ message: "Confirm node is missing required 'message' prop" });
          break;
        case "prose":
          // Check for unknown components in prose content
          checkUnknownComponents(node.content, errors);
          break;
      }
    }
  }

  function validateFields(fields: FieldDef[]) {
    for (const field of fields) {
      if (!VALID_FIELD_TYPES.has(field.type)) {
        errors.push({ message: `Invalid field type: "${field.type}" (use one of: text, number, boolean, list, object)` });
      }
      if (field.children) validateFields(field.children);
    }
  }

  function checkUnknownComponents(content: string, errors: ValidationError[]) {
    const tagRegex = /<([A-Z]\w*)/g;
    let m;
    while ((m = tagRegex.exec(content)) !== null) {
      if (!KNOWN_COMPONENTS.has(m[1])) {
        errors.push({ message: `Unknown component: <${m[1]}>` });
      }
    }
  }

  validateNodes(def.nodes);
  return errors;
}
