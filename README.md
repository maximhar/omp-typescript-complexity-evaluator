# omp-typescript-complexity-evaluator

Oh My Pi plugin for analyzing one TypeScript file and ranking its most complex functions.

It evaluates TypeScript functions with a weighted complexity model inspired by cognitive complexity, then surfaces the worst offenders with file-level context, detailed score breakdowns, and source locations. The plugin is useful when you want a fast, local signal for which functions deserve simplification before a broader refactor.

## Features

- Score a single `.ts` or `.tsx` file from an OMP tool call, OMP command, or MCP tool invocation
- Surface a summary complexity score that weights function complexity more heavily than file-level complexity
- Rank the worst functions by weighted complexity
- Report file-level complexity signals such as helper density and trivial helper overuse
- Include detailed per-function score breakdowns for cognitive complexity, duplication, reassignments, function length, call-chain depth, and helper depth
- Return structured details for downstream tooling while also rendering human-readable summaries over both OMP and MCP entrypoints
- Cover analyzer, extension, and MCP server behavior with fixture-based tests

## Requirements

- [Bun](https://bun.sh/) >= 1.3.7
- Oh My Pi / `@oh-my-pi/pi-coding-agent` v13 if you want the OMP plugin path

## Install

### From npm

```bash
omp plugin install omp-typescript-complexity-evaluator
```

### MCP server via Bunx

Configure any stdio-capable MCP client to run the packaged server binary through Bun:

```json
{
  "mcpServers": {
    "typescript-complexity": {
      "command": "bunx",
      "args": [
        "--package",
        "omp-typescript-complexity-evaluator",
        "omp-typescript-complexity-evaluator-mcp"
      ]
    }
  }
}
```

The MCP server exposes the same `score_typescript_complexity` tool as the OMP plugin.


For local development against a checked-out repository, point your MCP client at the repo directly:

```json
{
  "mcpServers": {
    "typescript-complexity-dev": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/omp-typescript-complexity-evaluator"
    }
  }
}
```
### Install the accompanying skill

The repository also includes the `typescript-complexity-refactor` skill under `skills/`. To make it available to OMP, install it into your local skills directory:

```bash
mkdir -p ~/.agents/skills
ln -sfn /path/to/omp-typescript-complexity-evaluator/skills/typescript-complexity-refactor ~/.agents/skills/typescript-complexity-refactor
```

If you prefer a copy instead of a symlink:

```bash
mkdir -p ~/.agents/skills/typescript-complexity-refactor
cp /path/to/omp-typescript-complexity-evaluator/skills/typescript-complexity-refactor/SKILL.md ~/.agents/skills/typescript-complexity-refactor/SKILL.md
```

Once installed, you can reference the skill from OMP when you want refactoring guidance that matches this evaluator's scoring model.

### Local development link

```bash
cd /path/to/omp-typescript-complexity-evaluator
bun install
bun link
omp plugin install omp-typescript-complexity-evaluator
```

You can also link the working tree directly:

```bash
omp plugin link /path/to/omp-typescript-complexity-evaluator
```

## Usage

### OMP tool

```text
score_typescript_complexity path=src/service.ts
```

### OMP command

```text
/complexity-score src/service.ts
```

### MCP server

Run the local stdio server during development:

```bash
bun run mcp
```

The MCP server exposes `score_typescript_complexity` with input like:

```json
{ "path": "src/service.ts" }
```

Successful calls return the same rendered text summary shown below plus structured JSON content containing the full `FileComplexitySummary` payload.

## Example output

```text
TypeScript complexity summary for src/service.ts
functions: 12 | summary complexity: 13.5 | average weighted score: 11.3 | highest weighted score: 42.0
ranked offenders: 10
overall file complexity: [medium] score 18.0

Top offenders:
1. processSettlementBatch (function) [high] score 42.0 @ 14:1-88:2
   metrics: cognitive 7×4=28, reassignments 2×4=8, loc max(0, 52-30)=22×1=22, duplication 0×2=0, many trivial helpers 0×1=0, trivial helper depth 0×1=0, call chain 2×1=2, name length (word-based) 0×1=0
```

## Development

```bash
bun install
bun run verify
```

Entrypoints:
- OMP extension: `src/extension.ts`
- MCP stdio server: `src/mcp-server.ts`

## Release

- Pushes to `main` and pull requests run CI, verify the package, and build an npm tarball artifact.
- Publishing is handled by GitHub Actions when you publish a GitHub Release, or manually via the `Publish to npm` workflow.
- The repo version is anchored at `1.0.0`; each successful npm publish auto-increments the patch version and commits the new published version back to `main`.
- The publish workflow uses the repository `NPM_TOKEN` secret and runs `npm publish --provenance --access public`.

## Repository layout

```text
bin/
  omp-typescript-complexity-evaluator-mcp  # Bun-backed MCP server executable

skills/
  typescript-complexity-refactor/
    SKILL.md                               # refactoring guidance tuned to this evaluator

src/
  analyzer.ts                              # core complexity analysis
  call-graph.ts                            # helper graph and call-chain metrics
  complexity-tool.ts                       # shared tool metadata and path resolution
  extension.ts                             # OMP tool and command registration
  function-resolution.ts                   # TypeScript symbol/function resolution
  mcp-server.ts                            # MCP stdio server registration
  metrics.ts                               # function collection and metric calculation
  render.ts                                # human-readable summaries
  types.ts                                 # shared result and weight types

test/
  analyzer.test.ts
  extension.test.ts
  mcp-server.test.ts
  fixtures/
```

## License

MIT
