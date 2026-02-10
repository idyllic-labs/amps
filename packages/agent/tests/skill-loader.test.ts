import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SkillLoader } from "../src/runtime/skill-loader.ts";

let tempDir: string;
let skillsDir: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "imps-skills-"));
  skillsDir = join(tempDir, "skills");
  mkdirSync(skillsDir);

  // Create a valid skill
  const weatherDir = join(skillsDir, "weather");
  mkdirSync(weatherDir);
  await Bun.write(
    join(weatherDir, "SKILL.md"),
    `---
name: weather
description: Get weather information
---

# Weather Skill

Use curl to fetch weather data from wttr.in.
References are relative to {baseDir}.
`,
  );

  // Create another skill
  const codeDir = join(skillsDir, "code-review");
  mkdirSync(codeDir);
  await Bun.write(
    join(codeDir, "SKILL.md"),
    `---
name: code-review
description: Review code for issues
---

# Code Review

Analyze the provided code for bugs and improvements.
`,
  );

  // Create a directory without SKILL.md (should be skipped)
  const emptyDir = join(skillsDir, "empty");
  mkdirSync(emptyDir);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("SkillLoader", () => {
  test("indexes available skills", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const names = loader.getAvailableSkillNames();
    expect(names).toContain("weather");
    expect(names).toContain("code-review");
    expect(names).toHaveLength(2);
  });

  test("returns skill descriptions", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const descriptions = loader.getSkillDescriptions();
    expect(descriptions).toHaveLength(2);

    const weather = descriptions.find((d) => d.name === "weather");
    expect(weather?.description).toBe("Get weather information");
  });

  test("loads skill content", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const content = await loader.loadSkill("weather");
    expect(content).toContain("Weather Skill");
    expect(content).toContain("curl");
  });

  test("substitutes {baseDir} in loaded content", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const content = await loader.loadSkill("weather");
    expect(content).not.toContain("{baseDir}");
    expect(content).toContain(join(skillsDir, "weather"));
  });

  test("loads skill body without frontmatter", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const body = await loader.loadSkillBody("weather");
    expect(body).not.toContain("---");
    expect(body).toContain("Weather Skill");
  });

  test("returns null for unknown skill", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const content = await loader.loadSkill("nonexistent");
    expect(content).toBeNull();
  });

  test("hasSkill returns correct values", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    expect(loader.hasSkill("weather")).toBe(true);
    expect(loader.hasSkill("nonexistent")).toBe(false);
  });

  test("formats skills for prompt as XML", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const prompt = loader.formatSkillsForPrompt();
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("</available_skills>");
    expect(prompt).toContain("<name>weather</name>");
    expect(prompt).toContain("<name>code-review</name>");
  });

  test("returns empty prompt when no skills", async () => {
    const emptyDir = join(tempDir, "no-skills");
    mkdirSync(emptyDir);
    const loader = new SkillLoader(emptyDir);
    await loader.indexSkills();

    expect(loader.formatSkillsForPrompt()).toBe("");
  });

  test("handles missing skills directory gracefully", async () => {
    const loader = new SkillLoader(join(tempDir, "does-not-exist"));
    await loader.indexSkills();

    expect(loader.getAvailableSkillNames()).toEqual([]);
  });

  test("caches loaded skills", async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.indexSkills();

    const first = await loader.loadSkill("weather");
    const second = await loader.loadSkill("weather");
    expect(first).toBe(second); // Same reference (cached)
  });
});
