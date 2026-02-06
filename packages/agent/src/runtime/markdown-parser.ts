import type {
  ParsedMarkdown,
  MarkdownSection,
  CodeBlock,
  AgentIdentity,
  HeartbeatConfig,
  SkillMetadata,
  RoutineTask,
} from "../types/index.ts";

/**
 * Parse markdown content into structured sections and code blocks
 */
export function parseMarkdown(content: string): ParsedMarkdown {
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  const codeBlocks: CodeBlock[] = [];
  let frontmatter: Record<string, string> | undefined;

  let currentSection: MarkdownSection | null = null;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockContent: string[] = [];
  let inFrontmatter = false;
  let frontmatterContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for frontmatter (YAML between --- lines)
    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      frontmatter = parseFrontmatter(frontmatterContent.join("\n"));
      frontmatterContent = [];
      continue;
    }
    if (inFrontmatter) {
      frontmatterContent.push(line);
      continue;
    }

    // Check for code block start/end
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End of code block
        codeBlocks.push({
          language: codeBlockLang,
          code: codeBlockContent.join("\n"),
        });
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Start of code block
        codeBlockLang = line.slice(3).trim();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Check for markdown headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section if exists
      if (currentSection) {
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        content: "",
      };
      continue;
    }

    // Add line to current section content
    if (currentSection) {
      currentSection.content += (currentSection.content ? "\n" : "") + line;
    }
  }

  // Add final section
  if (currentSection) {
    sections.push(currentSection);
  }

  return {
    frontmatter,
    sections,
    codeBlocks,
    rawContent: content,
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }

  return result;
}

/**
 * Parse agent.md into AgentIdentity
 */
export function parseAgentIdentity(markdown: ParsedMarkdown): AgentIdentity {
  const nameMatch = markdown.sections[0]?.heading?.match(/Agent:\s*(.+)/);
  const name = nameMatch?.[1] || "UnnamedAgent";

  const purposeSection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("purpose")
  );
  const purpose = purposeSection?.content.trim() || "";

  const capabilitiesSection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("capabilities")
  );
  const capabilities = capabilitiesSection
    ? extractListItems(capabilitiesSection.content)
    : [];

  const constraintsSection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("constraints")
  );
  const constraints = constraintsSection
    ? extractListItems(constraintsSection.content)
    : [];

  const personalitySection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("personality")
  );
  const personality = personalitySection?.content.trim();

  return {
    name,
    purpose,
    capabilities,
    constraints,
    personality,
  };
}

/**
 * Parse heartbeat.md into HeartbeatConfig
 */
export function parseHeartbeat(markdown: ParsedMarkdown): HeartbeatConfig {
  const scheduleSection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("schedule")
  );
  const scheduleMatch = scheduleSection?.content.match(/@every:\s*(.+)/);
  const schedule = scheduleMatch?.[1].trim() || "15m";

  const onWakeSection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("on wake")
  );
  const onWake = onWakeSection ? extractListItems(onWakeSection.content) : [];

  const routineSection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("routine")
  );
  const routineTasks: RoutineTask[] = [];
  if (routineSection) {
    const lines = routineSection.content.split("\n");
    for (const line of lines) {
      const match = line.match(/^-\s*(.+?):\s*(.+)$/);
      if (match) {
        routineTasks.push({
          schedule: match[1].trim(),
          description: match[2].trim(),
        });
      }
    }
  }

  const contextSection = markdown.sections.find((s) =>
    s.heading.toLowerCase().includes("context")
  );
  const contextReconstruction = contextSection
    ? extractListItems(contextSection.content)
    : undefined;

  return {
    schedule,
    onWake,
    routineTasks,
    contextReconstruction,
  };
}

/**
 * Parse skill markdown into SkillMetadata
 */
// parseSkill removed - skills now handled by SkillLoader with frontmatter

/**
 * Extract list items from markdown content
 */
function extractListItems(content: string): string[] {
  const items: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^[\s-]*[-*]\s*(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  return items;
}
