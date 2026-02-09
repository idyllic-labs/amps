# workflow

Deterministic document execution. Prose becomes prompt, components become actions, context accumulates top-to-bottom.

```bash
amps workflow run examples/workflows/blog-post.mdx --input topic="distributed systems"
```

## How it works

Workflows execute top-to-bottom. Prose accumulates onto a context stack. When execution reaches a `<Generation>`, the full context stack is joined into a single prompt and sent to the LLM. The response is stored as a named output _and_ appended to the context stack, so each subsequent generation sees everything above it.

```
Prose "Write a poem about {topic}"    →  context: [prose]
<Generation name="poem" />            →  LLM(context) → context: [prose, poem]
Prose "Now critique it."              →  context: [prose, poem, critique-prompt]
<Generation name="critique" />        →  LLM(context) — observes the poem it produced
```

Human input nodes (`<Prompt>`, `<Select>`, `<Confirm>`) suspend execution until the user responds. The submitted value is stored in outputs and appended to context, making it visible to all downstream generations.

## Interactive TUI

Workflows render in a terminal UI as they run:

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

## Components

### `<Generation />`

Invokes an LLM with the full accumulated context.

```mdx
Write me a poem about {topic}.

<Generation name="poem" />

Now critique the poem you just wrote.

<Generation name="critique" />
```

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

Suspends execution for the user to choose from options. Accepts a static array or an expression referencing prior output — enabling generative selection, where the LLM proposes candidates and the user narrows.

```mdx
{/* Fixed options */}

<Select name="tone" message="What tone?" options={["Formal", "Casual", "Playful"]} />

{/* Generative — options from a prior Structured output */}

<Select name="picked" message="Which one?" options={ideas.items} labelKey="title" />
```

Props: `name`, `message`, `options`, `labelKey`, `valueKey`

### `<Confirm />`

Suspends execution for a boolean confirmation.

```mdx
<Confirm name="proceed" message="Happy with this draft?" />
```

Props: `name`, `message`, `default`

### `<If />` / `<Else />`

Conditional execution.

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

Iterates over an array or runs N times.

```mdx
<Loop name="reviews" over={papers.items}>
  ## {item.title}
  <Generation name="review" />
</Loop>
```

Count-based: `<Loop name="attempts" count={3}>...</Loop>`

Loop variables: `{item}` (current element), `{index}` (iteration number).

### `<Flow />`

Invokes another `.mdx` file as a sub-workflow with isolated context.

```mdx
<Flow name="result" src="./summarize.mdx" inputs={{ text: article.content }} />
```

### `<Set />` / `<Log />`

Variable assignment and debug output.

```mdx
<Set name="final" value={draft} />
<Log>
  Processing {index + 1} of {items.length}
</Log>
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
{question} # variable access
{research.synthesis} # nested property access
{results[0].title} # array indexing
{`Hello ${name}`} # template literals
{items.filter(x => x.active)} # array methods
```

The expression scope includes all declared inputs and all named outputs produced so far.

## CLI

```
amps workflow run <file.mdx> [options]    Execute a workflow
amps workflow check <file.mdx>            Validate without executing

Options:
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

## Examples

See [`examples/workflows/`](../../examples/workflows):

| Workflow                                                              | What it does                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| [`blog-post`](../../examples/workflows/blog-post.mdx)                 | Structured outline → full generation                      |
| [`interview-prep`](../../examples/workflows/interview-prep.mdx)       | Role-specific questions → user selects → coached response |
| [`product-naming`](../../examples/workflows/product-naming.mdx)       | Multi-strategy brainstorm → narrowing → brand brief       |
| [`lesson-plan`](../../examples/workflows/lesson-plan.mdx)             | Topic exploration → structured lesson                     |
| [`draft-and-revise`](../../examples/workflows/draft-and-revise.mdx)   | Format/tone selection → draft → revision loop             |
| [`multi-perspective`](../../examples/workflows/multi-perspective.mdx) | Three expert perspectives → synthesis                     |
| [`chain-of-thought`](../../examples/workflows/chain-of-thought.mdx)   | Step-by-step reasoning → self-verification                |
| [`code-review`](../../examples/workflows/code-review.mdx)             | Structured issue analysis with severity ratings           |
| [`eli5`](../../examples/workflows/eli5.mdx)                           | Parallel complexity levels → nuance comparison            |
