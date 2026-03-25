# omp-typescript-complexity-evaluator

Oh My Pi plugin for analyzing one TypeScript file and ranking its most complex functions.

It evaluates TypeScript functions with a weighted complexity model inspired by cognitive complexity, then surfaces the worst offenders with file-level context, detailed score breakdowns, and source locations. The plugin is useful when you want a fast, local signal for which functions deserve simplification before a broader refactor.

## Features

- Score a single `.ts` file from an OMP tool call or command
- Rank the worst functions by weighted complexity
- Report file-level complexity signals such as helper density and trivial helper overuse
- Include detailed per-function score breakdowns for cognitive complexity, duplication, reassignments, function length, call-chain depth, and helper depth
- Return structured details for downstream tooling while also rendering human-readable summaries
- Cover analyzer and extension behavior with fixture-based tests

## Requirements

- [Bun](https://bun.sh/) >= 1.3.7
- Oh My Pi / `@oh-my-pi/pi-coding-agent` v13

## Install

### From npm

```bash
omp plugin install omp-typescript-complexity-evaluator
```

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

### Tool

```text
score_typescript_complexity path=src/service.ts
```

### Command

```text
/complexity-score src/service.ts
```

## Example output

```text
TypeScript complexity summary for src/service.ts
functions: 12 | average weighted score: 11.3 | highest weighted score: 42.0
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

The extension entry point is `src/extension.ts`.

## Release

- Pushes to `main` and pull requests run CI, verify the package, and build an npm tarball artifact.
- Publishing is handled by GitHub Actions when you publish a GitHub Release, or manually via the `Publish to npm` workflow.
- The repo version is anchored at `1.0.0`; each successful npm publish auto-increments the patch version and commits the new published version back to `main`.
- The publish workflow uses the repository `NPM_TOKEN` secret and runs `npm publish --provenance --access public`.

## Repository layout

```text
src/
  analyzer.ts             # core complexity analysis
  call-graph.ts           # helper graph and call-chain metrics
  extension.ts            # OMP tool and command registration
  function-resolution.ts  # TypeScript symbol/function resolution
  metrics.ts              # function collection and metric calculation
  render.ts               # human-readable summaries
  types.ts                # shared result and weight types

test/
  analyzer.test.ts
  extension.test.ts
  fixtures/
```

## License

MIT
