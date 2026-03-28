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

## Function Tree Mapping Before Refactoring

Before changing code, map the function tree for the area you want to refactor.

Do this explicitly for every relevant function:
- `<function name> [role]: <one-line description>`
- `Calls:`
  - `<called function 1>`
  - `<called function 2>`
  - `none`

Use these role labels:
- `orchestration`
- `validation`
- `translation`
- `derivation`
- `side effect`
- `wrapper/plumbing`
- `mixed` (only when one function currently owns too many roles)

### Recommended Analysis Format

```text
Function tree

<function A> [orchestration]: <short description>
  Calls:
  - <function B>
  - <function C>

<function B> [validation]: <short description>
  Calls:
  - none

<function C> [derivation]: <short description>
  Calls:
  - <function D>
```

### How To Use The Map

After writing the tree, classify each function:

- Merge candidates:
  - wrappers that only forward data
  - one-use helpers that only package arguments
  - tiny translation helpers with no standalone business meaning
- Keep candidates:
  - top-level orchestration functions
  - meaningful derivation functions
  - validation helpers that isolate a real concept
- Split candidates:
  - long functions mixing multiple roles, for example:
    - account lookup + currency validation + request building + logging
    - HTTP call + error extraction + shape validation + parsing
    - quote lookup + orientation validation + pricing math

### Concrete Example

```text
quotePlanningLanePricingMatrix [orchestration]: coordinates planning quote normalization, remote quote fetching, and lane pricing derivation
  Calls:
  - buildNormalizedLaneQuoteInputs
  - requestBulkPlanningQuotes
  - buildLanePricingMatrixFromQuoteResponses

buildNormalizedLaneQuoteInputs [normalization]: converts candidate lanes into quoteable lane inputs
  Calls:
  - buildNormalizedLanePlanningQuoteInput

buildNormalizedLanePlanningQuoteInput [mixed]: resolves bank accounts, resolves supported currencies and representative amounts, logs the lane, and builds forward/reverse quote requests
  Calls:
  - resolvePlanningLaneBankAccount
  - resolvePlanningQuoteRequestSide

requestBulkPlanningQuotes [validation + side effect]: sends bulk quote request, validates response status/body, and parses returned quotes
  Calls:
  - extractPlanningQuoteErrorResponse
  - isPlanningQuoteBatchResponse

buildLanePricingFromQuotes [derivation]: matches returned quotes to one lane, validates orientation, derives rate and cost_per_unit
  Calls:
  - resolveLanePlanningQuote
  - deriveQuotedRate
  - derivePlanningSpreadCostPerUnit
```

What this example shows:
- `quotePlanningLanePricingMatrix` should stay because it is a real orchestration phase.
- `buildNormalizedLanePlanningQuoteInput` should exist only if it keeps normalization separate from orchestration; if it becomes a blob, split only by real sub-concepts.
- `requestBulkPlanningQuotes` should stay, but only if response validation is not bloating it too much.
- `buildLanePricingFromQuotes` should stay because it is a real business derivation step.
- Tiny wrappers below that should be merged unless they isolate a real domain concept.

### Decision Rule Learned From Practice

If the tree shows too many nodes labeled `wrapper/plumbing`, flatten.

If the tree shows one function labeled with several unrelated roles, for example:
- validation + translation + logging + derivation

then split by semantic role.

Aim for a shallow tree, not a flat blob:
- 1 orchestration function
- a few meaningful phase helpers
- a few focused validation/derivation helpers
- no long chain of wrappers
- no monster function that owns everything

Important: do not optimize only for fewer functions. After each pass, check all three:
- function count
- worst-offender complexity
- summary file complexity

A refactor is successful when:
- the tree becomes simpler
- the worst offenders shrink
- responsibilities are easier to explain

## Practical Pattern That Worked Well

Important caution from later refactors:
- Reducing function count and reducing complexity score are related but not identical goals.
- Flattening a helper-heavy module too aggressively can improve the tree shape while making the remaining functions much worse by the scorer.
- In one follow-up refactor, collapsing ~30 helper functions to ~9 made the call tree simpler but concentrated complexity into 3 heavy functions (`buildNormalizedLaneQuoteInputs`, response handling, and quote-to-pricing correlation).
- Use a balanced target: collapse trivial wrappers and plumbing helpers first, but preserve a few real phase helpers so complexity does not pool into one long normalization or validation function.
- Heuristic: prefer roughly 2-4 meaningful helpers per business phase over either extreme (dozens of tiny wrappers or one giant orchestration blob).

A successful pattern for reducing a quote/planning helper file from severe offenders to all functions under 30 was:

1. Keep the exported orchestration function names if possible.
   - Name-length penalties are usually much smaller than LOC/cognitive penalties.
   - First try splitting business phases before renaming public APIs.

2. Split long orchestration functions into real domain phases such as:
   - resolve accounts / dependencies
   - resolve representative amounts or config
   - build request context / ids
   - build concrete forward/reverse requests
   - fetch remote response
   - validate unsuccessful response
   - extract successful payload
   - correlate response objects
   - derive final per-item pricing/output

3. Prefer a simple top-level loop over `map(...)` when the function is orchestrating multiple steps.
   - This keeps complexity local and avoids burying work in inline callbacks.

4. Extract validation and derivation helpers separately.
   - Validation helpers keep fail-closed behavior explicit.
   - Derivation helpers isolate math/translation logic from request orchestration.

5. Preserve behavior first, then optimize names only if still needed.
   - In one successful refactor, helper extraction alone reduced the worst function from 85 to 23, so a public API rename was unnecessary.

6. Watch for type-surface regressions after splitting response handling.
   - When a response body can be `undefined`, helper signatures should accept `undefined` and perform explicit fail-closed validation instead of assuming success-path typing.

## Review Checklist

After refactoring, ask:
- Did I reduce branches or only move them?
- Did I reduce reassignment or only rename mutable variables?
- Did I extract a real concept or create a scoring shim?
- Did I preserve transaction and failure semantics?
- Did I run the relevant lint/build/test checks after the optimization iteration?
- Did I make the next edit easier?

