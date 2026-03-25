import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
	analyzeTypeScriptComplexity,
	analyzeTypeScriptFile,
	analyzeTypeScriptSource,
} from "../src/analyzer.ts";
import { renderToolTextOutput } from "../src/render.ts";
import type { FileComplexitySummary, FunctionComplexityResult } from "../src/types.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixturePath(name: string): string {
	return path.join(FIXTURES_DIR, name);
}

function functionsById(summary: FileComplexitySummary): Map<string, FunctionComplexityResult> {
	return new Map(summary.functions.map((result) => [result.id, result]));
}

function totalImpact(contributions: Array<{ impact: number }>): number {
	return contributions.reduce((sum, contribution) => sum + contribution.impact, 0);
}

describe("analyzeTypeScriptFile", () => {
	it("collects supported function kinds and excludes anonymous inline callbacks", async () => {
		const summary = await analyzeTypeScriptFile(fixturePath("complexity-sample.ts"));

		expect(summary.functionCount).toBe(10);
		expect(
			summary.functions.map((result) => ({ id: result.id, kind: result.kind })),
		).toEqual([
			{ id: "parentBoundary", kind: "function" },
			{ id: "parentBoundary.deepHelper", kind: "function" },
			{ id: "storedArrow", kind: "arrow" },
			{ id: "storedExpression", kind: "function-expression" },
			{ id: "toolkit.format", kind: "object-method" },
			{ id: "Worker.constructor", kind: "constructor" },
			{ id: "Worker.compute", kind: "method" },
			{ id: "branchy", kind: "function" },
			{ id: "flatSwitch", kind: "function" },
			{ id: "locFixture", kind: "function" },
		]);
		expect(summary.functions.some((result) => result.id.includes("map") || result.id.includes("anonymous"))).toBeFalse();
	});

	it("analyzes tsx component files with stable functions", async () => {
		const summary = await analyzeTypeScriptFile(fixturePath("component-sample.tsx"));

		expect(summary.path).toBe(fixturePath("component-sample.tsx"));
		expect(summary.functionCount).toBe(2);
		expect(
			summary.functions.map((result) => ({ id: result.id, kind: result.kind })),
		).toEqual([
			{ id: "ScoreCard", kind: "function" },
			{ id: "ScoreBadge", kind: "function" },
		]);
		expect(renderToolTextOutput(summary)).toContain("component-sample.tsx");
	});

	it("keeps parent metrics isolated from nested helper bodies and orders offenders by severity", async () => {
		const summary = await analyzeTypeScriptFile(fixturePath("complexity-sample.ts"));
		const indexed = functionsById(summary);
		const parent = indexed.get("parentBoundary");
		const helper = indexed.get("parentBoundary.deepHelper");
		const topOffender = summary.worstFunctions[0];

		expect(parent).toMatchObject({
			bucket: "low",
			calls: ["parentBoundary.deepHelper"],
			metrics: {
				cognitiveComplexity: 0,
			},
			breakdown: {
				cognitiveComplexity: [],
			},
		});
		expect(helper).toMatchObject({
			bucket: "low",
			metrics: {
				cognitiveComplexity: 1,
			},
			breakdown: {
				cognitiveComplexity: [{ line: 3, impact: 1, category: "branching" }],
			},
		});
		expect(topOffender).toMatchObject({
			id: "branchy",
			displayName: "branchy",
			kind: "function",
			bucket: "high",
			metrics: {
				cognitiveComplexity: 15,
				manyTrivialHelpers: 0,
				trivialHelperDepth: 0,
				callChainDepth: 0,
				functionNameLength: 0,
			},
		});
		expect(topOffender.location.startLine).toBeGreaterThan(0);
		expect(topOffender.location.endLine).toBeGreaterThanOrEqual(topOffender.location.startLine);
		expect(summary.worstFunctions.map((result) => result.weightedScore)).toEqual(
			[...summary.worstFunctions.map((result) => result.weightedScore)].sort((left, right) => right - left),
		);
		expect(topOffender.location.startLine).toBeGreaterThan(0);
		expect(topOffender.location.endLine).toBeGreaterThanOrEqual(topOffender.location.startLine);
		expect(summary.worstFunctions.map((result) => result.weightedScore)).toEqual(
			[...summary.worstFunctions.map((result) => result.weightedScore)].sort((left, right) => right - left),
		);
	});

	it("computes cognitive breakdowns and loc on stable examples", async () => {
		const summary = await analyzeTypeScriptFile(fixturePath("complexity-sample.ts"));
		const indexed = functionsById(summary);
		const branchy = indexed.get("branchy");
		const flatSwitch = indexed.get("flatSwitch");
		const locFixture = indexed.get("locFixture");

		expect(branchy).toMatchObject({
			bucket: "high",
			metrics: {
				cognitiveComplexity: 15,
			},
			breakdown: {
				cognitiveComplexity: [
					{ line: 37, impact: 1, category: "branching" },
					{ line: 37, impact: 1, category: "logic" },
					{ line: 38, impact: 2, category: "looping" },
					{ line: 39, impact: 3, category: "branching" },
					{ line: 39, impact: 3, category: "branching" },
					{ line: 43, impact: 1, category: "branching" },
					{ line: 43, impact: 1, category: "logic" },
					{ line: 46, impact: 2, category: "exception" },
					{ line: 51, impact: 1, category: "branching" },
				],
			},
		});
		expect(flatSwitch).toMatchObject({
			bucket: "low",
			metrics: {
				cognitiveComplexity: 1,
			},
			breakdown: {
				cognitiveComplexity: [{ line: 62, impact: 1, category: "branching" }],
			},
		});
		expect(branchy).toBeDefined();
		expect(flatSwitch).toBeDefined();
		if (!branchy || !flatSwitch) {
			throw new Error("Expected branchy and flatSwitch results.");
		}
		expect(branchy.metrics.cognitiveComplexity).toBeGreaterThan(flatSwitch.metrics.cognitiveComplexity);
		expect(locFixture?.metrics.functionLoc).toBe(2);
		expect(totalImpact(branchy.breakdown.cognitiveComplexity)).toBe(branchy.metrics.cognitiveComplexity);
		expect(totalImpact(flatSwitch.breakdown.cognitiveComplexity)).toBe(flatSwitch.metrics.cognitiveComplexity);
	});

	it("scores logical operator sequences, mixed operators, and negated groups", () => {
		const summary = analyzeTypeScriptSource(
			[
				"function sameFamily(a: boolean, b: boolean, c: boolean): boolean {",
				"    if (a && b && c) {",
				"        return true;",
				"    }",
				"    return false;",
				"}",
				"",
				"function mixed(a: boolean, b: boolean, c: boolean, d: boolean): boolean {",
				"    if (a && b || c && d) {",
				"        return true;",
				"    }",
				"    return false;",
				"}",
				"",
				"function negated(a: boolean, b: boolean, c: boolean, d: boolean): boolean {",
				"    if (a && !(b && c) && d) {",
				"        return true;",
				"    }",
				"    return false;",
				"}",
			].join("\n"),
			"inline.ts",
		);

		const indexed = functionsById(summary);
		expect(indexed.get("sameFamily")).toMatchObject({
			metrics: {
				cognitiveComplexity: 2,
			},
			breakdown: {
				cognitiveComplexity: [
					{ line: 2, impact: 1, category: "branching" },
					{
						line: 2,
						impact: 1,
						category: "logic",
						rule: { kind: "logical-sequence", operators: ["&&", "&&"], operatorChangeCount: 0, negatedGroup: false },
					},
				],
			},
		});
		expect(indexed.get("mixed")).toMatchObject({
			metrics: {
				cognitiveComplexity: 4,
			},
			breakdown: {
				cognitiveComplexity: [
					{ line: 9, impact: 1, category: "branching" },
					{
						line: 9,
						impact: 3,
						category: "logic",
						rule: { kind: "logical-sequence", operators: ["&&", "||", "&&"], operatorChangeCount: 2, negatedGroup: false },
					},
				],
			},
		});
		expect(indexed.get("negated")).toMatchObject({
			metrics: {
				cognitiveComplexity: 3,
			},
			breakdown: {
				cognitiveComplexity: [
					{ line: 16, impact: 1, category: "branching" },
					{
						line: 16,
						impact: 1,
						category: "logic",
						rule: { kind: "logical-sequence", operators: ["&&", "&&"], operatorChangeCount: 0, negatedGroup: false },
					},
					{
						line: 16,
						impact: 1,
						category: "logic",
						rule: { kind: "logical-sequence", operators: ["&&"], operatorChangeCount: 0, negatedGroup: true },
					},
				],
			},
		});
		expect(renderToolTextOutput(summary)).toContain(
			"9 logic +3 [logical sequence; operators && → || → &&, 2 operator changes]",
		);
		expect(renderToolTextOutput(summary)).toContain(
			"16 logic +1 [logical sequence; operators &&, negated group]",
		);
	});

	it("treats else-if as another branch and discounts ternary else arms", () => {
		const summary = analyzeTypeScriptSource(
			[
				"function ladder(value: number, flag: boolean): number {",
				"    if (value > 0) {",
				"        return 1;",
				"    } else if (flag) {",
				"        return 2;",
				"    }",
				"    return 3;",
				"}",
				"",
				"function ternary(flag: boolean): number {",
				"    return flag ? 1 : 2;",
				"}",
			].join("\n"),
			"inline.ts",
		);

		const indexed = functionsById(summary);
		expect(indexed.get("ladder")).toMatchObject({
			metrics: {
				cognitiveComplexity: 2,
			},
			breakdown: {
				cognitiveComplexity: [
					{ line: 2, impact: 1, category: "branching" },
					{ line: 4, impact: 1, category: "branching" },
				],
			},
		});
		expect(indexed.get("ternary")).toMatchObject({
			metrics: {
				cognitiveComplexity: 1,
			},
			breakdown: {
				cognitiveComplexity: [{ line: 11, impact: 1, category: "branching" }],
			},
		});
	});

	it("scores direct recursion without penalizing ordinary same-file calls", () => {
		const summary = analyzeTypeScriptSource(
			[
				"function countdown(value: number): number {",
				"    if (value <= 0) {",
				"        return 0;",
				"    }",
				"    return countdown(value - 1);",
				"}",
				"",
				"function helper(value: number): number {",
				"    return value + 1;",
				"}",
				"",
				"function wrapper(value: number): number {",
				"    return helper(value);",
				"}",
			].join("\n"),
			"inline.ts",
		);

		const indexed = functionsById(summary);
		expect(indexed.get("countdown")).toMatchObject({
			calls: ["countdown"],
			metrics: {
				cognitiveComplexity: 2,
			},
			breakdown: {
				cognitiveComplexity: [
					{ line: 2, impact: 1, category: "branching" },
					{
						line: 5,
						impact: 1,
						category: "recursion",
						rule: { kind: "recursion", recursionType: "direct" },
					},
				],
			},
		});
		expect(indexed.get("wrapper")).toMatchObject({
			calls: ["helper"],
			metrics: {
				cognitiveComplexity: 0,
			},
			breakdown: {
				cognitiveComplexity: [],
			},
		});
	});


	it("detects repeated same-shape blocks even when identifiers are renamed", async () => {
		const summary = await analyzeTypeScriptFile(fixturePath("duplication-sample.ts"));
		const indexed = functionsById(summary);

		expect(indexed.get("normalizeOrders")).toMatchObject({
			metrics: {
				duplication: 3,
			},
		});
		expect(indexed.get("normalizeInvoices")).toMatchObject({
			metrics: {
				duplication: 3,
			},
		});
		expect(indexed.get("uniqueProcess")).toMatchObject({
			metrics: {
				duplication: 0,
			},
		});
		expect(summary.worstFunctions.map((result) => result.id).slice(0, 2)).toEqual([
			"normalizeOrders",
			"normalizeInvoices",
		]);
	});

	it("applies small helper penalties and stays cycle-safe", async () => {
		const summary = await analyzeTypeScriptFile(fixturePath("call-graph-sample.ts"));
		const indexed = functionsById(summary);

		expect(indexed.get("orchestrate")).toMatchObject({
			calls: ["cycleEntry", "stepA", "stepB", "stepC"],
			metrics: {
				manyTrivialHelpers: 2,
				trivialHelperDepth: 1,
				callChainDepth: 0,
				functionNameLength: 0,
			},
		});
		expect(indexed.get("stepC")).toMatchObject({
			calls: ["normalize"],
		});
		expect(indexed.get("cycleEntry")).toMatchObject({
			calls: ["cycleNext"],
			metrics: {
				functionNameLength: 0,
			},
		});
		expect(indexed.get("cycleNext")).toMatchObject({
			calls: ["cycleEntry"],
			metrics: {
				functionNameLength: 0,
			},
		});
	});

	it("reports overall file complexity metrics on a dedicated fixture", async () => {
		const summary = await analyzeTypeScriptFile(fixturePath("file-complexity-sample.ts"));
		const { breakdown, metrics, weightedScore, bucket } = summary.overallFileComplexity;

		expect(metrics).toMatchObject({
			totalFunctionCount: 7,
			eligibleFunctionCount: 7,
			topLevelFunctionCount: 1,
			nonTopLevelFunctionCount: 6,
			helpersPerTopLevelFunction: 6,
			trivialSingleUseNonTopLevelFunctionCount: 4,
			trivialSingleUseNonTopLevelFunctionNames: ["parseInput", "assembleResult", "computeOffset", "inlineAdjustment"],
		});
		expect(breakdown).toEqual({
			helpersPerTopLevelFunction: { value: 6, weight: 2, contribution: 12 },
			trivialSingleUseNonTopLevelFunctions: { value: 4, weight: 4, contribution: 16 },
		});
		expect(weightedScore).toBeCloseTo(28, 10);
		expect(summary.summaryScore).toBeCloseTo(10.19047619047619, 10);
		expect(bucket).toBe("medium");
	});

	it("classifies top-level functions from same-file inbound calls and excludes constructors from eligibility", () => {
		const summary = analyzeTypeScriptSource(
			[
				"class Manager {",
				"\tconstructor(value: number) {",
				"\t\tthis.handle(value);",
				"\t}",
				"",
				"\tunusedMethod(value: number): number {",
				"\t\treturn value + 1;",
				"\t}",
				"",
				"\thandle(value: number): number {",
				"\t\treturn helper(value);",
				"\t}",
				"}",
				"",
				"function helper(value: number): number {",
				"\treturn value - 1;",
				"}",
			].join("\n"),
			"inline.ts",
		);

		expect(summary.overallFileComplexity.metrics).toMatchObject({
			totalFunctionCount: 4,
			eligibleFunctionCount: 3,
			topLevelFunctionCount: 1,
			nonTopLevelFunctionCount: 2,
			helpersPerTopLevelFunction: 2,
			trivialSingleUseNonTopLevelFunctionCount: 2,
			trivialSingleUseNonTopLevelFunctionNames: ["Manager.handle", "helper"],
		});
		expect(summary.overallFileComplexity.breakdown).toEqual({
			helpersPerTopLevelFunction: { value: 2, weight: 2, contribution: 4 },
			trivialSingleUseNonTopLevelFunctions: { value: 2, weight: 4, contribution: 8 },
		});
		expect(summary.overallFileComplexity.weightedScore).toBeCloseTo(12, 10);
		expect(summary.overallFileComplexity.bucket).toBe("low");
	});

	it("uses the helpers-per-top-level-function ratio and worsens scores when the same top-level count fans out more", () => {
		const buildSource = (helpersPerTopLevel: number): string =>
			Array.from({ length: 4 }, (_, topIndex) => {
				const helperNames = Array.from(
					{ length: helpersPerTopLevel },
					(_, helperIndex) => `helper${topIndex}_${helperIndex}`,
				);
				const topFunctionLines = [
					`function top${topIndex}(value: number): number {`,
					`\treturn ${helperNames.map((helperName) => `${helperName}(value)`).join(" + ")};`,
					"}",
					"",
				];
				const helperLines = helperNames.flatMap((helperName, helperIndex) => [
					`function ${helperName}(value: number): number {`,
					`\tif (value > ${helperIndex}) {`,
					`\t\treturn value + ${helperIndex + 1};`,
					"\t}",
					`\treturn value - ${helperIndex + 1};`,
					"}",
					"",
				]);
				return [...topFunctionLines, ...helperLines];
			})
				.flat()
				.join("\n");

		const balancedSummary = analyzeTypeScriptSource(buildSource(1), "inline.ts");
		const worseSummary = analyzeTypeScriptSource(buildSource(3), "inline.ts");

		expect(balancedSummary.overallFileComplexity.metrics).toMatchObject({
			totalFunctionCount: 8,
			eligibleFunctionCount: 8,
			topLevelFunctionCount: 4,
			nonTopLevelFunctionCount: 4,
			helpersPerTopLevelFunction: 1,
			trivialSingleUseNonTopLevelFunctionCount: 0,
			trivialSingleUseNonTopLevelFunctionNames: [],
		});
		expect(balancedSummary.overallFileComplexity.breakdown.helpersPerTopLevelFunction).toEqual({
			value: 1,
			weight: 2,
			contribution: 2,
		});
		expect(balancedSummary.overallFileComplexity.weightedScore).toBeCloseTo(2, 10);

		expect(worseSummary.overallFileComplexity.metrics).toMatchObject({
			totalFunctionCount: 16,
			eligibleFunctionCount: 16,
			topLevelFunctionCount: 4,
			nonTopLevelFunctionCount: 12,
			helpersPerTopLevelFunction: 3,
			trivialSingleUseNonTopLevelFunctionCount: 0,
			trivialSingleUseNonTopLevelFunctionNames: [],
		});
		expect(worseSummary.overallFileComplexity.breakdown.helpersPerTopLevelFunction).toEqual({
			value: 3,
			weight: 2,
			contribution: 6,
		});
		expect(worseSummary.overallFileComplexity.weightedScore).toBeGreaterThan(
			balancedSummary.overallFileComplexity.weightedScore,
		);
	});

	it("skips scarcity ratio contribution when no top-level functions remain", () => {
		const summary = analyzeTypeScriptSource(
			[
				"function first(value: number): number {",
				"\tif (value > 0) {",
				"\t\treturn second(value - 1);",
				"\t}",
				"\treturn value;",
				"}",
				"",
				"function second(value: number): number {",
				"\tif (value < 0) {",
				"\t\treturn first(value + 1);",
				"\t}",
				"\treturn first(value);",
				"}",
			].join("\n"),
			"inline.ts",
		);

		expect(summary.overallFileComplexity.metrics).toMatchObject({
			totalFunctionCount: 2,
			eligibleFunctionCount: 2,
			topLevelFunctionCount: 0,
			nonTopLevelFunctionCount: 2,
			helpersPerTopLevelFunction: undefined,
			trivialSingleUseNonTopLevelFunctionCount: 0,
			trivialSingleUseNonTopLevelFunctionNames: [],
		});
		expect(summary.overallFileComplexity.breakdown).toEqual({
			helpersPerTopLevelFunction: { value: undefined, weight: 2, contribution: 0 },
			trivialSingleUseNonTopLevelFunctions: { value: 0, weight: 4, contribution: 0 },
		});
		expect(summary.overallFileComplexity.weightedScore).toBe(0);
		expect(summary.summaryScore).toBeCloseTo(2.6666666666666665, 10);
		expect(summary.overallFileComplexity.bucket).toBe("low");
	});


	it("supports file and source entrypoints and reports truthful path errors", async () => {
		const samplePath = fixturePath("complexity-sample.ts");
		const sourceText = await Bun.file(samplePath).text();
		const fromFile = await analyzeTypeScriptFile(samplePath);
		const fromComplexity = await analyzeTypeScriptComplexity({ path: samplePath, sourceText });
		const fromSource = analyzeTypeScriptSource(sourceText, samplePath);

		expect(fromComplexity).toEqual(fromFile);
		expect(fromSource).toEqual(fromFile);
		await expect(analyzeTypeScriptFile(path.join(FIXTURES_DIR, "missing.ts"))).rejects.toThrow(
			`TypeScript file not found: ${path.join(FIXTURES_DIR, "missing.ts")}`,
		);
		expect(() => analyzeTypeScriptSource("export const value = 1;", "inline.js")).toThrow(
			"Expected a .ts or .tsx file path, received 'inline.js'.",
		);
	});
	it("counts a one-line return with a template literal as one LOC", () => {
		const summary = analyzeTypeScriptSource(
			[
				"function buildLaneApiTransactionIdempotencyKey(fxRebalancingId: string, laneKey: string): string {",
				'    return `${fxRebalancingId}-${laneKey}-${SystemApiTransactionType.FxRebalancing}`;',
				"}",
			].join("\n"),
			"inline.ts",
		);

		expect(summary.functions).toHaveLength(1);
		expect(summary.functions[0]).toMatchObject({
			id: "buildLaneApiTransactionIdempotencyKey",
			metrics: {
				functionLoc: 1,
				functionNameLength: 6,
			},
			weightedScore: 6,
		});
	});

	it("only starts LOC scoring after 30 lines", () => {
		const buildFunction = (statementCount: number): string => {
			const statements = Array.from({ length: statementCount - 1 }, (_, index) => `const value${index} = ${index};`);
			statements.push("return 0;");
			return [`function thresholdCase(): number {`, ...statements.map(statement => `    ${statement}`), `}`].join("\n");
		};

		const thirtyLineSummary = analyzeTypeScriptSource(buildFunction(30), "inline.ts");
		const thirtyOneLineSummary = analyzeTypeScriptSource(buildFunction(31), "inline.ts");

		expect(thirtyLineSummary.functions[0]).toMatchObject({
			metrics: {
				functionLoc: 30,
			},
			weightedScore: 0,
		});
		expect(thirtyOneLineSummary.functions[0]).toMatchObject({
			metrics: {
				functionLoc: 31,
			},
			weightedScore: 1,
		});
	});

	it("counts anonymous callback complexity toward the parent but keeps stable nested helpers separate", () => {
		const summary = analyzeTypeScriptSource(
			[
				"function parent(items: number[]): number {",
				"    const stable = (value: number): number => {",
				"        if (value > 0) {",
				"            return value;",
				"        }",
				"        return 0;",
				"    };",
				"",
				"    items.map(item => {",
				"        if (item > 0) {",
				"            stable(item);",
				"        }",
				"        return item;",
				"    });",
				"",
				"    return stable(0);",
				"}",
			].join("\n"),
			"inline.ts",
		);

		const indexed = functionsById(summary);
		expect(summary.functions.map(result => result.id)).toEqual(["parent", "parent.stable"]);
		expect(indexed.get("parent")).toMatchObject({
			calls: ["parent.stable"],
			metrics: {
				cognitiveComplexity: 1,
			},
			breakdown: {
				cognitiveComplexity: [{ line: 10, impact: 1, category: "branching" }],
			},
		});
		expect(indexed.get("parent.stable")).toMatchObject({
			metrics: {
				cognitiveComplexity: 1,
			},
			breakdown: {
				cognitiveComplexity: [{ line: 3, impact: 1, category: "branching" }],
			},
		});
	});

	it("counts variable reassignments with x4 weighting", () => {
		const summary = analyzeTypeScriptSource(
			[
				"function reassignments(input: number): number {",
				"    let total = input;",
				"    total = total + 1;",
				"    total += 2;",
				"    total++;",
				"    --total;",
				"    ({ total } = { total: input });",
				"    [total] = [input];",
				"    return total;",
				"}",
			].join("\n"),
			"inline.ts",
		);

		expect(summary.functions[0]).toMatchObject({
			metrics: {
				reassignmentCount: 6,
				functionLoc: 8,
			},
			weightedScore: 24,
		});
	});

});
