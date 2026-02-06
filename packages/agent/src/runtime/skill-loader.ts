import { readdirSync, statSync, existsSync } from "fs";
import { resolve } from "path";
import type { SkillMetadata } from "../types/index.ts";
import { logger } from "../shared/logger.ts";

/**
 * Loads and manages skills following the Agent Skills standard
 * Skills are SKILL.md files with YAML frontmatter in subdirectories
 */
export class SkillLoader {
  private skillsDir: string;
  private availableSkills: Map<string, SkillMetadata> = new Map();
  private loadedSkills: Map<string, string> = new Map();

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * Index all available skills (scan for SKILL.md files)
   * Extracts name and description from frontmatter
   */
  async indexSkills(): Promise<void> {
    if (!existsSync(this.skillsDir)) {
      logger.warn(`Skills directory not found: ${this.skillsDir}`);
      return;
    }

    const entries = readdirSync(this.skillsDir);

    for (const entry of entries) {
      const entryPath = resolve(this.skillsDir, entry);

      // Skip if not a directory
      if (!statSync(entryPath).isDirectory()) {
        continue;
      }

      // Look for SKILL.md in the directory
      const skillPath = resolve(entryPath, "SKILL.md");
      if (!existsSync(skillPath)) {
        continue;
      }

      try {
        const content = await Bun.file(skillPath).text();
        const metadata = this.parseSkillMetadata(content, skillPath, entryPath);

        if (metadata) {
          this.availableSkills.set(metadata.name, metadata);
          logger.debug(`Indexed skill: ${metadata.name}`);
        }
      } catch (error) {
        logger.error(`Failed to index skill at ${skillPath}:`, error);
      }
    }

    logger.info(`Indexed ${this.availableSkills.size} skill(s)`);
  }

  /**
   * Parse skill frontmatter and extract metadata
   */
  private parseSkillMetadata(
    content: string,
    filePath: string,
    baseDir: string
  ): SkillMetadata | null {
    // Extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      logger.warn(`No frontmatter found in ${filePath}`);
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const lines = frontmatter.split("\n");

    let name = "";
    let description = "";

    for (const line of lines) {
      const [key, ...valueParts] = line.split(":");
      const value = valueParts.join(":").trim();

      if (key.trim() === "name") {
        name = value;
      } else if (key.trim() === "description") {
        description = value;
      }
    }

    if (!name || !description) {
      logger.warn(`Missing name or description in ${filePath}`);
      return null;
    }

    return {
      name,
      description,
      filePath,
      baseDir,
    };
  }

  /**
   * Get all available skill descriptions for system prompt
   */
  getSkillDescriptions(): Array<{ name: string; description: string }> {
    return Array.from(this.availableSkills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
  }

  /**
   * Load full skill content by name
   * Returns the complete SKILL.md content with {baseDir} replaced
   */
  async loadSkill(skillName: string): Promise<string | null> {
    // Check if already loaded
    if (this.loadedSkills.has(skillName)) {
      return this.loadedSkills.get(skillName)!;
    }

    const metadata = this.availableSkills.get(skillName);
    if (!metadata) {
      logger.warn(`Skill not found: ${skillName}`);
      return null;
    }

    try {
      let content = await Bun.file(metadata.filePath).text();

      // Replace {baseDir} placeholder with actual base directory
      content = content.replace(/{baseDir}/g, metadata.baseDir);

      // Cache the loaded skill
      this.loadedSkills.set(skillName, content);

      logger.info(`Loaded skill: ${skillName}`);
      return content;
    } catch (error) {
      logger.error(`Failed to load skill ${skillName}:`, error);
      return null;
    }
  }

  /**
   * Load skill body content without frontmatter
   */
  async loadSkillBody(skillName: string): Promise<string | null> {
    const content = await this.loadSkill(skillName);
    if (!content) return null;
    return this.stripFrontmatter(content).trim();
  }

  /**
   * Format skill descriptions as XML for system prompt
   * Following pi-coding-agent format
   */
  formatSkillsForPrompt(): string {
    const skills = this.getSkillDescriptions();

    if (skills.length === 0) {
      return "";
    }

    const lines: string[] = [
      "",
      "The following skills provide specialized instructions for specific tasks.",
      "Use the read tool to load a skill's file when the task matches its description.",
      "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
      "",
      "<available_skills>",
    ];

    for (const skill of this.availableSkills.values()) {
      lines.push("  <skill>");
      lines.push(`    <name>${this.escapeXml(skill.name)}</name>`);
      lines.push(`    <description>${this.escapeXml(skill.description)}</description>`);
      lines.push(`    <location>${this.escapeXml(skill.filePath)}</location>`);
      lines.push("  </skill>");
    }

    lines.push("</available_skills>");
    return lines.join("\n");
  }

  /**
   * Get skill metadata by name
   */
  getSkillMetadata(skillName: string): SkillMetadata | undefined {
    return this.availableSkills.get(skillName);
  }

  private stripFrontmatter(content: string): string {
    const match = content.match(/^---\n[\s\S]*?\n---\n?/);
    if (!match) return content;
    return content.slice(match[0].length);
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Get list of available skill names
   */
  getAvailableSkillNames(): string[] {
    return Array.from(this.availableSkills.keys());
  }

  /**
   * Check if a skill exists
   */
  hasSkill(skillName: string): boolean {
    return this.availableSkills.has(skillName);
  }
}
