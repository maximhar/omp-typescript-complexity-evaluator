import * as ts from "typescript";

import { buildFunctionCallGraph, isTrivialFunction } from "./call-graph.ts";
import {
	collectStableFunctions,
	computeFunctionMetrics,
	createTypeScriptSourceFile,
	type CollectedFunction,
} from "./metrics.ts";
import {
	DEFAULT_BUCKET_THRESHOLDS,
	DEFAULT_SCORE_WEIGHTS,
	getWeightedFunctionLoc,
	type ComplexityBucket,
	type FileComplexityBreakdown,
	type FileComplexityMetrics,
	type FileComplexitySummary,
	type FunctionComplexityMetrics,
	type FunctionComplexityResult,
	type OverallFileComplexity,
} from "./types.ts";

export interface AnalyzeTypeScriptOptions {
	path: string;
	sourceText?: string;
}

const DEFAULT_WORST_FUNCTION_COUNT = 10;
const SUPPORTED_TYPESCRIPT_EXTENSIONS = [".ts", ".tsx"];

const FUNCTION_SUMMARY_WEIGHT = 2 / 3;
const FILE_SUMMARY_WEIGHT = 1 / 3;

export async function analyzeTypeScriptComplexity(
	options: AnalyzeTypeScriptOptions,
): Promise<FileComplexitySummary> {
	const path = validateTypeScriptPath(options.path);
	const sourceText = options.sourceText ?? (await readTypeScriptFile(path));
	return analyzeTypeScriptSource(sourceText, path);
}

export async function analyzeTypeScriptFile(path: string): Promise<FileComplexitySummary> {
	return analyzeTypeScriptComplexity({ path });
}

export function analyzeTypeScriptSource(
	sourceText: string,
	path = "inline.ts",
): FileComplexitySummary {
	const normalizedPath = validateTypeScriptPath(path);
	const sourceFile = createTypeScriptSourceFile(normalizedPath, sourceText);
	const program = createInMemoryProgram(sourceFile);
	const checker = program.getTypeChecker();
	const functions = collectStableFunctions(sourceFile);
	const complexityByFunctionId = computeFunctionMetrics(functions, sourceFile, checker);
	const metricsByFunctionId = new Map(
		[...complexityByFunctionId].map(([functionId, analysis]) => [functionId, analysis.metrics]),
	);
	const callGraph = buildFunctionCallGraph(functions, sourceFile, checker, metricsByFunctionId);

	const functionResults = functions.map<FunctionComplexityResult>((currentFunction) => {
		const complexity = complexityByFunctionId.get(currentFunction.id);
		if (!complexity) {
			throw new Error(`Missing metrics for function '${currentFunction.id}'.`);
		}
		const graphMetrics = callGraph.graphMetricsByFunctionId.get(currentFunction.id);
		if (!graphMetrics) {
			throw new Error(`Missing graph metrics for function '${currentFunction.id}'.`);
		}
		const combinedMetrics = { ...complexity.metrics, ...graphMetrics };
		const weightedScore = computeWeightedScore(combinedMetrics);
		return {
			id: currentFunction.id,
			displayName: currentFunction.displayName,
			kind: currentFunction.kind,
			location: currentFunction.location,
			metrics: combinedMetrics,
			breakdown: complexity.breakdown,
			calls: callGraph.callsByFunctionId.get(currentFunction.id) ?? [],
			weightedScore,
			bucket: getBucket(weightedScore),
		};
	});

	const overallFileComplexity = computeOverallFileComplexity(
		functions,
		metricsByFunctionId,
		callGraph.inboundCallCountByFunctionId,
	);
	const functionsBySourceOrder = [...functionResults].sort(compareBySourceLocation);
	const worstFunctions = [...functionResults]
		.sort(compareBySeverity)
		.slice(0, DEFAULT_WORST_FUNCTION_COUNT);
	const totalScore = functionResults.reduce((sum, result) => sum + result.weightedScore, 0);
	const highestScore = worstFunctions[0]?.weightedScore ?? 0;
	const averageScore = functionResults.length === 0 ? 0 : totalScore / functionResults.length;
	const summaryScore = computeSummaryScore(averageScore, overallFileComplexity.weightedScore);

	return {
		path: normalizedPath,
		functionCount: functionResults.length,
		highestScore,
		averageScore,
		summaryScore,
		overallFileComplexity,
		worstFunctions,
		functions: functionsBySourceOrder,
	};
}

function computeOverallFileComplexity(
	functions: readonly CollectedFunction[],
	metricsByFunctionId: ReadonlyMap<string, FunctionComplexityMetrics>,
	inboundCallCountByFunctionId: ReadonlyMap<string, number>,
): OverallFileComplexity {
	const totalFunctionCount = functions.length;
	const eligibleFunctions = functions.filter((currentFunction) => currentFunction.kind !== "constructor");
	const topLevelFunctions = eligibleFunctions.filter(
		(currentFunction) => (inboundCallCountByFunctionId.get(currentFunction.id) ?? 0) === 0,
	);
	const nonTopLevelFunctionCount = eligibleFunctions.length - topLevelFunctions.length;
	const trivialSingleUseNonTopLevelFunctions = eligibleFunctions.filter(
		(currentFunction) => (inboundCallCountByFunctionId.get(currentFunction.id) ?? 0) === 1 && isTrivialFunction(metricsByFunctionId.get(currentFunction.id)),
	);
	const metrics: FileComplexityMetrics = {
		totalFunctionCount,
		eligibleFunctionCount: eligibleFunctions.length,
		topLevelFunctionCount: topLevelFunctions.length,
		nonTopLevelFunctionCount,
		helpersPerTopLevelFunction: computeHelpersPerTopLevelFunction(nonTopLevelFunctionCount, topLevelFunctions.length),
		trivialSingleUseNonTopLevelFunctionCount: trivialSingleUseNonTopLevelFunctions.length,
		trivialSingleUseNonTopLevelFunctionNames: trivialSingleUseNonTopLevelFunctions.map(
			(currentFunction) => currentFunction.displayName,
		),
	};
	const breakdown = computeOverallFileComplexityBreakdown(metrics);
	const weightedScore = computeOverallFileWeightedScore(breakdown);

	return {
		metrics,
		breakdown,
		weightedScore,
		bucket: getBucket(weightedScore),
	};
}

function computeOverallFileWeightedScore(breakdown: FileComplexityBreakdown): number {
	return breakdown.helpersPerTopLevelFunction.contribution + breakdown.trivialSingleUseNonTopLevelFunctions.contribution;
}

function computeSummaryScore(averageScore: number, overallFileWeightedScore: number): number {
	return averageScore * FUNCTION_SUMMARY_WEIGHT + overallFileWeightedScore * FILE_SUMMARY_WEIGHT;
}

function computeOverallFileComplexityBreakdown(
	metrics: FileComplexityMetrics,
): FileComplexityBreakdown {
	return {
		helpersPerTopLevelFunction: computeScoreComponent(metrics.helpersPerTopLevelFunction, 2),
		trivialSingleUseNonTopLevelFunctions: computeScoreComponent(
			metrics.trivialSingleUseNonTopLevelFunctionCount,
			4,
		),
	};
}

function computeScoreComponent(value: number | undefined, weight: number) {
	return {
		value,
		weight,
		contribution: (value ?? 0) * weight,
	};
}

function computeHelpersPerTopLevelFunction(
	nonTopLevelFunctionCount: number,
	topLevelFunctionCount: number,
): number | undefined {
	if (topLevelFunctionCount === 0) {
		return undefined;
	}

	return nonTopLevelFunctionCount / topLevelFunctionCount;
}

async function readTypeScriptFile(path: string): Promise<string> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`TypeScript file not found: ${path}`);
	}
	return file.text();
}

function validateTypeScriptPath(path: string): string {
	if (!SUPPORTED_TYPESCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension))) {
		throw new Error(`Expected a .ts or .tsx file path, received '${path}'.`);
	}
	return path;
}

function createInMemoryProgram(sourceFile: ts.SourceFile): ts.Program {
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		noEmit: true,
		noResolve: true,
		noLib: true,
		jsx: ts.JsxEmit.Preserve,
	};

	const host: ts.CompilerHost = {
		fileExists: (fileName) => fileName === sourceFile.fileName,
		readFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile.text : undefined),
		getSourceFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile : undefined),
		getDefaultLibFileName: () => "lib.d.ts",
		writeFile: () => undefined,
		getCurrentDirectory: () => "",
		getDirectories: () => [],
		getCanonicalFileName: (fileName) => fileName,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => "\n",
	};

	return ts.createProgram({
		rootNames: [sourceFile.fileName],
		options,
		host,
	});
}

function computeWeightedScore(metrics: FunctionComplexityResult["metrics"]): number {
	return (
		metrics.cognitiveComplexity * DEFAULT_SCORE_WEIGHTS.cognitiveComplexity +
		metrics.reassignmentCount * DEFAULT_SCORE_WEIGHTS.reassignmentCount +
		getWeightedFunctionLoc(metrics.functionLoc) * DEFAULT_SCORE_WEIGHTS.functionLoc +
		metrics.duplication * DEFAULT_SCORE_WEIGHTS.duplication +
		metrics.manyTrivialHelpers * DEFAULT_SCORE_WEIGHTS.manyTrivialHelpers +
		metrics.trivialHelperDepth * DEFAULT_SCORE_WEIGHTS.trivialHelperDepth +
		metrics.callChainDepth * DEFAULT_SCORE_WEIGHTS.callChainDepth +
		metrics.functionNameLength * DEFAULT_SCORE_WEIGHTS.functionNameLength
	);
}

function getBucket(weightedScore: number): ComplexityBucket {
	if (weightedScore >= DEFAULT_BUCKET_THRESHOLDS.severe) {
		return "severe";
	}
	if (weightedScore >= DEFAULT_BUCKET_THRESHOLDS.high) {
		return "high";
	}
	if (weightedScore >= DEFAULT_BUCKET_THRESHOLDS.medium) {
		return "medium";
	}
	return "low";
}

function compareBySeverity(
	left: FunctionComplexityResult,
	right: FunctionComplexityResult,
): number {
	return (
		right.weightedScore - left.weightedScore ||
		right.metrics.cognitiveComplexity - left.metrics.cognitiveComplexity ||
		compareBySourceLocation(left, right) ||
		left.id.localeCompare(right.id)
	);
}

function compareBySourceLocation(
	left: Pick<FunctionComplexityResult, "location">,
	right: Pick<FunctionComplexityResult, "location">,
): number {
	return (
		left.location.startLine - right.location.startLine ||
		left.location.startColumn - right.location.startColumn ||
		left.location.endLine - right.location.endLine ||
		left.location.endColumn - right.location.endColumn
	);
}
