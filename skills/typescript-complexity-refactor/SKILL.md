---
name: typescript-complexity-refactor
description: Refactor TypeScript to reduce complexity scores from the local complexity tool without gaming the metric. Encodes the current scoring model, safe refactoring priorities, and a ready-to-paste optimization prompt.
---

# TypeScript Complexity Refactor

Use this skill when reducing function complexity in TypeScript measured by the local complexity tool. The ground-truth scorer is the `score_typescript_complexity` tool; optimize against its current behavior, not against intuition alone.

## Current Scoring Model

Weighted score per function:
- `4 * cognitiveComplexity`
- `4 * reassignmentCount`
- `1 * max(0, functionLoc - 30)`
- `2 * duplication`
- `1 * manyTrivialHelpers`
- `1 * trivialHelperDepth`
- `1 * callChainDepth`
- `1 * functionNameLength`

Helper/call/name add-ons:
- too many trivial one-line helpers
- trivial helper chain depth
- call chain depth
- long multi-word function names

Current analyzer behavior:
- Anonymous inline callbacks count toward the parent function.
- Stable named helpers/methods are scored separately.
- Parent functions do not absorb stable nested helper internals.
- Analysis is file-local only.
- LOC counts code lines only, not blank/comment-only lines.
- Reassignments count; declarations do not.
- Cognitive complexity covers `if` / `else if`, loops, `switch`, `catch`, ternary, logical-operator sequences, and direct recursion.
- Mixed `&&` / `||` chains add one logical-sequence increment plus one more for each operator-family change.
- Negated grouped logical expressions like `!(a && b)` start a separate logical sequence.
- `switch` counts once, not per `case`; ternary is cheaper than a full `if`/`else`; plain `else` adds no standalone increment.

## Refactoring Priorities

1. Reduce branching and nesting with guard clauses and early returns.
2. Reduce reassignment; prefer single-assignment flow and expression-oriented code.
3. Split real business phases into semantically named helpers.
4. Remove duplicated control-flow or repeated statement patterns.
5. Keep helpers meaningful; avoid trivial wrappers and deep helper chains.
6. Do not hide complexity inside anonymous callbacks.
7. Preserve behavior, types, side effects, transactions, locks, logging, and failure semantics.

## What To Optimize First

### Highest-signal reductions
- deep nesting inside branching/looping constructs
- else-if ladders and multi-branch conditionals
- mixed `&&` / `||` conditions or negated grouped boolean expressions
- repeated reassignment of the same variable
- repeated statement blocks across sibling functions
- orchestration methods mixing multiple business phases
- direct recursion when an iterative or phased alternative is clearer

### Lower-signal reductions
- shaving a few LOC below 30 if the code becomes less clear
- replacing one readable conditional with indirection
- splitting code into tiny helpers that only forward arguments

## Reassignment Guidance

Reassignment is weighted heavily (`x4`). Prefer:
- guard clauses over mutable status flags
- building immutable intermediate values instead of patching one object repeatedly
- returning early instead of mutating accumulator state across branches
- narrow-scope variables over long-lived mutable locals

Avoid needless mutation like:
- `let result = ...; result = ...; result = ...;`
- boolean progress flags that can be replaced with structured returns
- mutable temporary objects incrementally assembled across unrelated phases when a single construction step is clearer

## Extraction Rules

Extract helpers only when they are:
- semantically named
- single-purpose
- meaningful at the business level
- not merely hiding a branch from the scorer

Bad extraction targets:
- tiny pass-through wrappers
- one-line “call and return” helpers
- helpers that exist only to move an `if` elsewhere
- chains of helpers where each one does almost nothing

Good extraction targets:
- validation phase
- plan building phase
- transactional state transition phase
- payload assembly with a clear business meaning
- repeated domain calculation used in multiple places

## Good Prompt To Give Another LLM

```text
You are refactoring TypeScript to reduce function complexity without changing behavior.

Optimize for this scoring model:
- 4 * cognitiveComplexity
- 4 * reassignmentCount
- 1 * max(0, functionLoc - 30)
- 2 * duplication
- 1 * manyTrivialHelpers
- 1 * trivialHelperDepth
- 1 * callChainDepth
- 1 * functionNameLength

Important analyzer behavior:
- Anonymous inline callbacks count toward the parent function.
- Stable named helpers/methods are scored separately.
- Parent functions do not absorb stable nested helper internals.
- Analysis is file-local only.
- LOC counts code lines only, not blank/comment-only lines.
- Reassignments count; declarations do not.
- Cognitive complexity covers `if` / `else if`, loops, `switch`, `catch`, ternary, logical-operator sequences, and direct recursion.
- Mixed `&&` / `||` chains add one logical-sequence increment plus one more for each operator-family change.
- Negated grouped logical expressions like `!(a && b)` start a separate logical sequence.
- `switch` counts once, not per `case`; ternary is cheaper than a full `if`/`else`; plain `else` adds no standalone increment.
- Do not “hide” complexity in anonymous callbacks.
- Do not replace complexity with long helper chains or many trivial one-line wrappers.

Your goal is not to game the metric. Your goal is to make the code genuinely easier to understand and safer to change.

Refactoring priorities, in order:
1. Reduce branching and nesting with guard clauses and early returns.
2. Eliminate unnecessary reassignment; prefer single-assignment flow.
3. Split genuinely independent responsibilities into semantically named helpers.
4. Remove duplicated control-flow or repeated statement patterns.
5. Keep helpers meaningful; do not create trivial pass-through wrappers.
6. Prefer explicit, readable code over clever compression.
7. Preserve types, invariants, side effects, logging, transaction boundaries, and error semantics.
8. Do not change public behavior, return values, or failure modes unless explicitly requested.
9. After each optimization iteration, run the relevant lint/build/test checks before continuing.

When refactoring:
- Keep orchestration at the top level and move detail into helpers only when the helper has real business meaning.
- Prefer named helpers over inline callbacks when extraction is warranted.
- Avoid deep call chains.
- Avoid introducing new abstraction layers unless they clearly simplify the design.
- Prefer immutable/local expressions over repeatedly mutating the same variable.
- If a function is long only because it builds one structured object, reduce reassignment first before splitting.
- If a function is complex because it mixes phases, split it by business phase boundaries.

For each changed function:
- explain briefly why the score should improve
- mention which dimensions improved: cognitive, reassignment, LOC, duplication, helper penalties, call-chain depth, name length
- call out any tradeoff where a small LOC increase reduces more important complexity
- if boolean conditions changed, say whether you reduced operator mixing, extracted named predicates, or removed a negated grouped condition

Do not optimize by:
- moving logic into anonymous callbacks
- scattering logic across many tiny helpers
- deleting validation or error handling
- weakening types
- changing transaction/locking behavior
- hiding control flow behind generic utilities unless they truly clarify the code

Return:
1. the refactored code
2. a short rationale per affected function
3. any residual complexity you intentionally kept and why
```

## Review Checklist

After refactoring, ask:
- Did I reduce branches or only move them?
- Did I reduce reassignment or only rename mutable variables?
- Did I extract a real concept or create a scoring shim?
- Did I preserve transaction and failure semantics?
- Did I run the relevant lint/build/test checks after the optimization iteration?
- Did I make the next edit easier?
