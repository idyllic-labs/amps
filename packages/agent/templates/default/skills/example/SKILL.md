---
name: example
description: Example skill demonstrating the Agent Skills standard format
---

# Example Skill

This skill demonstrates the Agent Skills standard format.

## When to Use

Use this skill when you need to:

- See an example of skill structure
- Understand how to create new skills
- Reference the standard format

## Instructions

1. Skills are defined in `SKILL.md` files
2. Frontmatter contains `name` and `description`
3. The agent sees descriptions in the system prompt
4. Full content is loaded when the agent invokes the skill

## Helper Files

You can reference helper files at: {baseDir}/

For example:

- {baseDir}/script.sh
- {baseDir}/config.json

## Examples

```bash
# Example bash command
echo "Skill executed from {baseDir}"
```

```typescript
// Example TypeScript code
async function exampleFunction(input: string) {
  console.log("Processing:", input);
  return `Result: ${input}`;
}
```

## Notes

- Keep SKILL.md under 500 lines
- Express instructions as actionable steps
- Delegate deterministic tasks to scripts
- Agent decides when to use this skill based on the description
