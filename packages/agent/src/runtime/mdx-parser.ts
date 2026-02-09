/**
 * MDX Agent Parser
 * Parses .agent.mdx files with inline <Tool> components into AgentMdxDefinition.
 * Extracts Tool blocks (with Param tags and code), strips them, and passes the
 * remainder through the existing markdown identity parser.
 */

import type { AgentIdentity } from "../types/index.ts";
import { parseMarkdown, parseAgentIdentity } from "./markdown-parser.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedParam {
  name: string;
  type: "string" | "number" | "boolean";
  description?: string;
  required: boolean;
}

export interface ParsedToolDef {
  name: string;
  description: string;
  params: ParsedParam[];
  code: string;
}

export interface AgentMdxDefinition {
  identity: AgentIdentity;
  tools: ParsedToolDef[];
  frontmatter: Record<string, string>;
}

// ─── Tag Parsing Helpers ────────────────────────────────────────────────────

/**
 * Find the matching closing brace for an opening `{` at position `start`.
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
      const quote = ch;
      i++;
      while (i < str.length) {
        if (str[i] === "\\") {
          i++;
        } else if (str[i] === quote) {
          break;
        }
        i++;
      }
    }
    i++;
  }
  return -1;
}

interface ParsedProps {
  [key: string]: string;
}

/**
 * Parse JSX-like props from a tag attribute string.
 * Returns raw string values (not Expression objects — we only need simple strings here).
 */
function parseProps(attrStr: string): ParsedProps {
  const props: ParsedProps = {};
  let i = 0;
  const s = attrStr.trim();

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    const keyStart = i;
    while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) i++;
    const key = s.slice(keyStart, i);
    if (!key) {
      i++;
      continue;
    }

    while (i < s.length && /\s/.test(s[i])) i++;

    if (s[i] !== "=") {
      props[key] = "true";
      continue;
    }
    i++; // skip '='

    while (i < s.length && /\s/.test(s[i])) i++;

    if (s[i] === '"') {
      i++;
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
      props[key] = val;
    } else if (s[i] === "{") {
      const end = findMatchingBrace(s, i);
      if (end === -1) {
        props[key] = s.slice(i + 1);
        break;
      }
      props[key] = s.slice(i + 1, end).trim();
      i = end + 1;
    } else {
      const valStart = i;
      while (i < s.length && !/\s/.test(s[i])) i++;
      props[key] = s.slice(valStart, i);
    }
  }

  return props;
}

interface TagMatch {
  name: string;
  attrs: string;
  start: number;
  end: number;
}

function matchOpeningTag(source: string, pos: number): TagMatch | null {
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
    } else if (slice[i] === "/" && slice[i + 1] === ">") {
      return null; // self-closing
    } else if (slice[i] === ">") {
      const attrs = slice.slice(nameMatch[0].length, i).trim();
      return { name, attrs, start: pos, end: pos + i + 1 };
    } else {
      i++;
    }
  }
  return null;
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
      i++;
      while (i < slice.length && slice[i] !== '"') {
        if (slice[i] === "\\") i++;
        i++;
      }
      i++;
    } else if (slice[i] === "/" && slice[i + 1] === ">") {
      const attrs = slice.slice(nameMatch[0].length, i).trim();
      return { name, attrs, start: pos, end: pos + i + 2 };
    } else if (slice[i] === ">") {
      return null; // opening tag, not self-closing
    } else {
      i++;
    }
  }
  return null;
}

function findClosingTag(source: string, tagName: string, startIdx: number): number {
  let depth = 1;
  let i = startIdx;
  while (i < source.length) {
    const selfCloseMatch = matchSelfClosingTag(source, i);
    if (selfCloseMatch && selfCloseMatch.name === tagName) {
      i = selfCloseMatch.end;
      continue;
    }
    const openMatch = matchOpeningTag(source, i);
    if (openMatch && openMatch.name === tagName) {
      depth++;
      i = openMatch.end;
      continue;
    }
    const closeRegex = new RegExp(`<\\/${tagName}\\s*>`);
    const closeMatch = source.slice(i).match(closeRegex);
    if (closeMatch && closeMatch.index === 0) {
      depth--;
      if (depth === 0) return i;
      i += closeMatch[0].length;
      continue;
    }
    i++;
  }
  return -1;
}

// ─── Tool Block Parsing ─────────────────────────────────────────────────────

/**
 * Extract <Param /> self-closing tags from Tool inner content.
 */
function parseParamTags(inner: string): ParsedParam[] {
  const params: ParsedParam[] = [];
  let i = 0;
  while (i < inner.length) {
    const selfClose = matchSelfClosingTag(inner, i);
    if (selfClose && selfClose.name === "Param") {
      const props = parseProps(selfClose.attrs);
      params.push({
        name: props.name || "",
        type: (props.type as "string" | "number" | "boolean") || "string",
        description: props.description,
        required: props.required !== "false",
      });
      i = selfClose.end;
      continue;
    }
    i++;
  }
  return params;
}

/**
 * Extract fenced code block content from Tool inner content.
 * Looks for ```typescript ... ``` or ```ts ... ```
 */
function extractCodeBlock(inner: string): string {
  const match = inner.match(/```(?:typescript|ts)\s*\n([\s\S]*?)```/);
  if (!match) return "";
  return match[1].trim();
}

/**
 * Parse a single <Tool>...</Tool> block.
 */
function parseToolBlock(attrs: string, inner: string): ParsedToolDef {
  const props = parseProps(attrs);
  const params = parseParamTags(inner);
  const code = extractCodeBlock(inner);

  return {
    name: props.name || "",
    description: props.description || "",
    params,
    code,
  };
}

// ─── Main Export ────────────────────────────────────────────────────────────

/**
 * Parse an agent .mdx file into identity + inline tool definitions.
 * Extracts all <Tool>...</Tool> blocks, strips them from the source,
 * then passes the remainder through the standard markdown identity parser.
 */
export function parseAgentMdx(source: string): AgentMdxDefinition {
  const tools: ParsedToolDef[] = [];
  let stripped = source;

  // Repeatedly find and extract <Tool>...</Tool> blocks
  while (true) {
    // Find next <Tool opening tag
    let toolPos = -1;
    for (let i = 0; i < stripped.length; i++) {
      const open = matchOpeningTag(stripped, i);
      if (open && open.name === "Tool") {
        toolPos = i;
        break;
      }
    }
    if (toolPos === -1) break;

    const open = matchOpeningTag(stripped, toolPos)!;
    const closeIdx = findClosingTag(stripped, "Tool", open.end);
    if (closeIdx === -1) break;

    const inner = stripped.slice(open.end, closeIdx);
    const closeTagEnd = closeIdx + "</Tool>".length;

    tools.push(parseToolBlock(open.attrs, inner));

    // Remove the tool block from the source
    stripped = stripped.slice(0, toolPos) + stripped.slice(closeTagEnd);
  }

  // Parse remaining content as standard markdown for identity
  const markdown = parseMarkdown(stripped);
  const identity = parseAgentIdentity(markdown);

  return { identity, tools, frontmatter: markdown.frontmatter ?? {} };
}
