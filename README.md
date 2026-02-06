# mdx-ai

Scriptable AI tools that run locally. The document is the program.

```mdx
---
name: blog-post
inputs:
  topic: text
---

Write an outline for a blog post about "{topic}".

<Structured name="outline">
  <Field name="title" type="text" />
  <Field name="sections" type="list">
    <Field name="heading" type="text" />
  </Field>
</Structured>

Now write the full blog post following this outline.

<Generation name="post" />
```

Prose becomes prompt. Components become actions. Context accumulates top-to-bottom. This is the complete execution model.

## Motivation

Conventional AI tooling requires building an application before testing an idea. MDX inverts this: the document is both the specification and the interface. A workflow that reads clearly as a document executes correctly as a program. There is no authoring layer to hide behind — the prose _is_ the prompt, and the component structure _is_ the control flow.

Running locally, in the terminal, means colocating with the actual working environment: source code, files, existing tools. This makes iteration immediate rather than mediated through deployment.

mdx-ai is a research substrate for identifying what the right primitives for AI scripting are — what composes reliably, what remains legible at scale, what deserves first-class support. The included workflows and agents are both experiments in primitive design and minimally useful tools worth customizing for local use.

From [Idyllic Labs](https://idylliclabs.com), where we research composable primitives for programmable intelligence.

## Interactive execution

Workflows execute in an interactive TUI that renders the document as it runs:

```
 ╭─ interview-prep ──────────────────────────────────────────╮
 │  Inputs: role = "senior frontend engineer"                │
 ╰───────────────────────────────────────────────────────────╯

 ◆ Structured  questions                          azure/gpt-5.2
   { "items": [
     { "question": "Tell me about a time you improved performance...", ... },
     ...
   ] }

 ? Select  picked                   Which question do you want to practice?
     ❯ Tell me about a time you improved performance on a critical path
       Describe your approach to component architecture decisions
       Walk me through how you'd debug a production rendering issue

 ○ Select  approach                                       waiting

 ○ Generation  answer                                     pending

─────────────────────────────────────────────────────────────
 ⠹ Running  interview-prep          azure/gpt-5.2          0:12
```

Prose renders inline. Generation tokens stream in real-time. Structured output materializes as JSON. Human input nodes pause execution and present TUI widgets — text inputs, select lists, confirmations — then resume on submission.

## Setup

```bash
git clone <repo> && cd mdx-ai
bun install
```

```bash
# Interactive TUI (auto-detected in terminal)
bun run mdx-ai workflow run examples/workflows/haiku.mdx --input topic="the ocean"

# JSON output
bun run mdx-ai workflow run examples/workflows/haiku.mdx --input topic="the ocean" --output json

# Validate without executing
bun run mdx-ai workflow check examples/workflows/blog-post.mdx
```

### Environment

```bash
# Required for Azure OpenAI (default provider)
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_RESOURCE_NAME=...
```

Model format: `provider/model` (e.g. `azure/gpt-5.2`, `openai/gpt-4.1`). Default: `azure/gpt-5.2`. Override per-run with `--model`.

## Examples

Self-contained workflows in [`examples/workflows/`](./examples/workflows):

| Workflow | Description |
|----------|-------------|
| [`interview-prep`](examples/workflows/interview-prep.mdx) | Generates role-specific questions, user selects one, chooses an answer framework; produces a draft response and critique |
| [`draft-and-revise`](examples/workflows/draft-and-revise.mdx) | User selects format and tone, receives a draft, confirms or provides revision feedback |
| [`product-naming`](examples/workflows/product-naming.mdx) | Brainstorms names via multiple strategies, user narrows to a favorite, optionally explores variations, produces a brand brief |
| [`lesson-plan`](examples/workflows/lesson-plan.mdx) | Generates subtopics for a subject, user selects focus area, duration, and teaching style; outputs a structured lesson plan |
| [`blog-post`](examples/workflows/blog-post.mdx) | Structured outline followed by full-length generation |
| [`multi-perspective`](examples/workflows/multi-perspective.mdx) | Three expert perspectives on a question with cross-perspective synthesis |
| [`chain-of-thought`](examples/workflows/chain-of-thought.mdx) | Step-by-step reasoning with self-verification and correction |
| [`code-review`](examples/workflows/code-review.mdx) | Structured issue analysis with severity ratings and conditional revision |
| [`eli5`](examples/workflows/eli5.mdx) | Parallel explanations at two levels of complexity, then a comparison of what nuance is lost |

```bash
bun run mdx-ai workflow run examples/workflows/product-naming.mdx --input description="a CLI tool for running AI workflows"
```

## Execution model

Workflows execute top-to-bottom. Prose accumulates onto a context stack. When execution reaches a `<Generation>`, the full context stack is joined into a single prompt and sent to the LLM. The response is stored as a named output _and_ appended to the context stack, so each subsequent generation sees everything above it.

```
Prose "Write a poem about {topic}"    →  context: [prose]
<Generation name="poem" />            →  LLM(context) → context: [prose, poem]
Prose "Now critique it."              →  context: [prose, poem, critique-prompt]
<Generation name="critique" />        →  LLM(context) — observes the poem it produced
```

Human input nodes (`<Prompt>`, `<Select>`, `<Confirm>`) suspend execution until the user responds. The submitted value is stored in outputs and appended to context, making it visible to all downstream generations.

## Components

### `<Generation />`

Invokes an LLM with the full accumulated context.

```mdx
Write me a poem about {topic}.
<Generation name="poem" />

Now critique the poem you just wrote.
<Generation name="critique" />
```

The second generation receives the original prompt, the poem, and the critique instruction.

Props: `name`, `model`, `temperature`, `maxTokens`, `stop`

### `<Structured />`

Constrains LLM output to a typed JSON schema.

```mdx
<Structured name="analysis">
  <Field name="summary" type="text" description="One sentence" />
  <Field name="keyPoints" type="list">
    <Field type="text" />
  </Field>
  <Field name="confidence" type="number" description="0 to 1" />
</Structured>
```

Field types: `text`, `number`, `boolean`, `list`, `object`. Nest `<Field>` blocks for complex structures.

### `<Prompt />`

Suspends execution for free-text input.

```mdx
<Prompt name="topic" message="What topic?" />
<Prompt name="count" message="How many?" type="number" default={3} />
```

Props: `name`, `message`, `default`, `type` (`"text"` | `"number"`)

### `<Select />`

Suspends execution for the user to choose from a set of options. Options accept a static array or an expression referencing prior output — enabling generative selection, where the LLM proposes candidates and the user narrows.

```mdx
{/* Fixed options */}
<Select name="tone" message="What tone?" options={["Formal", "Casual", "Playful"]} />

{/* Generative — options derived from a prior Structured output */}
<Select name="picked" message="Which one?" options={ideas.items} labelKey="title" />
```

Props: `name`, `message`, `options`, `labelKey`, `valueKey`

### `<Confirm />`

Suspends execution for a boolean confirmation.

```mdx
<Confirm name="proceed" message="Happy with this draft?" />

<If condition={proceed}>
  ...
</If>
```

Props: `name`, `message`, `default`

### `<If />` / `<Else />`

Conditional execution based on an expression.

```mdx
<If condition={score >= 80}>
  Congratulations!
  <Generation name="message" />
</If>
<Else>
  Keep trying.
  <Generation name="message" />
</Else>
```

### `<Loop />`

Iterates over an array or runs N times. Each iteration receives fresh context from the loop entry point.

```mdx
<Loop name="reviews" over={papers.items}>
  ## {item.title}
  <Generation name="review" />
</Loop>
```

Count-based: `<Loop name="attempts" count={3}>...</Loop>`

Loop variables: `{item}` is the current element, `{index}` is the iteration number.

### `<Flow />`

Invokes another `.mdx` file as a sub-workflow with isolated context.

```mdx
<Flow name="result" src="./summarize.mdx" inputs={{ text: article.content }} />
```

### `<Set />` / `<Log />`

Variable assignment and debug output, respectively.

```mdx
<Set name="final" value={draft} />
<Log>Processing {index + 1} of {items.length}</Log>
```

### `<WebSearch />` / `<WebFetch />`

Web retrieval. Results are appended to context for downstream generations.

```mdx
<WebSearch name="results" query={`${topic} latest research`} maxResults={5} />
<WebFetch name="page" url={results.results[0].url} />
```

## Frontmatter

Declares inputs with types and defaults. Optionally restricts which named outputs are returned.

```yaml
---
name: my-workflow
inputs:
  question: text
  depth: number = 2
  verbose: boolean = false
  tags: list<text>
outputs:
  - report
  - sources
---
```

Input types: `text`, `number`, `boolean`, `list<T>`, `object`

## Expressions

JavaScript expressions evaluate inside `{}`:

```mdx
{question}                          # variable access
{research.synthesis}                # nested property access
{results[0].title}                  # array indexing
{`Hello ${name}`}                   # template literals
{items.filter(x => x.active)}      # array methods
```

The expression scope includes all declared inputs and all named outputs produced so far.

## CLI

```
mdx-ai workflow run <file.mdx> [options]    Execute a workflow
mdx-ai workflow check <file.mdx>            Validate without executing
mdx-ai agent <agent-path>                   Start an agent

Options (workflow):
  --input key=value    Pass an input (repeatable)
  --inputs <file>      Load inputs from JSON file
  --output <format>    pretty (default), json, yaml
  --stream             Stream NDJSON events
  --model <model>      Override model
  --interactive        Force TUI mode
  --no-interactive     Force non-interactive mode
  --verbose            Show execution context
```

In non-interactive mode, `<Prompt>`, `<Select>`, and `<Confirm>` resolve from `--input` values and defaults, enabling headless execution in CI and pipelines.

## Packages

| Package | Description |
|---------|-------------|
| [`@mdx-ai/workflow`](packages/workflow) | Workflow parser, executor, TUI, and CLI |
| [`@mdx-ai/agent`](packages/agent) | Persistent agent runtime with markdown-defined behavior, skills, memory, and a background daemon |

## Development

```bash
bun install
bun run typecheck                                        # typecheck all packages
bun run mdx-ai workflow run examples/workflows/haiku.mdx --input topic=rain  # execute a workflow
```

---

[Idyllic Labs](https://idylliclabs.com) · San Francisco
