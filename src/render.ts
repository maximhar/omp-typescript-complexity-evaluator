import * as path from "node:path";

import {
	DEFAULT_SCORE_WEIGHTS,
	FUNCTION_LOC_WEIGHT_THRESHOLD,
	getWeightedFunctionLoc,
	type FileComplexitySummary,
	type FunctionComplexityResult,
} from "./types.ts";

const DEFAULT_NOTIFY_OFFENDER_COUNT = 5;

interface RenderOptions {
	cwd?: string;
	maxOffenders?: number;
}

export function formatFileLevelSummary(summary: FileComplexitySummary, options: RenderOptions = {}): string {
	const displayPath = getDisplayPath(summary.path, options.cwd);
	const offenderCount = Math.min(summary.worstFunctions.length, options.maxOffenders ?? summary.worstFunctions.length);
	const heading = `TypeScript complexity summary for ${displayPath}`;
	const stats = [
		`functions: ${summary.functionCount}`,
		`summary complexity: ${formatScore(summary.summaryScore)}`,
		`average weighted score: ${formatScore(summary.averageScore)}`,
		`highest weighted score: ${formatScore(summary.highestScore)}`,
	];

	return [heading, stats.join(" | "), `ranked offenders: ${offenderCount}`].join("\n");
}

function formatOverallFileComplexity(summary: FileComplexitySummary): string[] {
	const { bucket, breakdown, metrics, weightedScore } = summary.overallFileComplexity;
	const trivialHelperList = metrics.trivialSingleUseNonTopLevelFunctionNames.length === 0

		? "none"
		: metrics.trivialSingleUseNonTopLevelFunctionNames.join(", ");
	return [
		`overall file complexity: [${bucket}] score ${formatScore(weightedScore)}`,
		`file score breakdown: helpers per top-level function ${formatOptionalRatio(breakdown.helpersPerTopLevelFunction.value, "n/a (no top-level functions)")}×${formatScore(breakdown.helpersPerTopLevelFunction.weight)}=${formatScore(breakdown.helpersPerTopLevelFunction.contribution)}, trivial single-use non-top-level functions ${breakdown.trivialSingleUseNonTopLevelFunctions.value ?? 0}×${formatScore(breakdown.trivialSingleUseNonTopLevelFunctions.weight)}=${formatScore(breakdown.trivialSingleUseNonTopLevelFunctions.contribution)}`,
		`file metrics: top-level functions ${metrics.topLevelFunctionCount}/${metrics.eligibleFunctionCount}, non-top-level functions ${metrics.nonTopLevelFunctionCount}/${metrics.eligibleFunctionCount}, helpers per top-level function ${formatOptionalRatio(metrics.helpersPerTopLevelFunction, "n/a (no top-level functions)")}, trivial single-use non-top-level functions ${metrics.trivialSingleUseNonTopLevelFunctionCount}`,
		`trivial helper contributors: ${trivialHelperList}`,
	];
}

export function formatRankedOffenderLine(result: FunctionComplexityResult, rank: number): string {
	const location = `${result.location.startLine}:${result.location.startColumn}-${result.location.endLine}:${result.location.endColumn}`;
	return `${rank}. ${result.displayName} (${result.kind}) [${result.bucket}] score ${formatScore(result.weightedScore)} @ ${location}`;
}

export function formatRankedOffenderBreakdown(result: FunctionComplexityResult): string[] {
	const weightedMetricBreakdown = [
		`cognitive ${result.metrics.cognitiveComplexity}×${DEFAULT_SCORE_WEIGHTS.cognitiveComplexity}=${result.metrics.cognitiveComplexity * DEFAULT_SCORE_WEIGHTS.cognitiveComplexity}`,
		`reassignments ${result.metrics.reassignmentCount}×${DEFAULT_SCORE_WEIGHTS.reassignmentCount}=${result.metrics.reassignmentCount * DEFAULT_SCORE_WEIGHTS.reassignmentCount}`,
		`loc max(0, ${result.metrics.functionLoc}-${FUNCTION_LOC_WEIGHT_THRESHOLD})=${getWeightedFunctionLoc(result.metrics.functionLoc)}×${DEFAULT_SCORE_WEIGHTS.functionLoc}=${getWeightedFunctionLoc(result.metrics.functionLoc) * DEFAULT_SCORE_WEIGHTS.functionLoc}`,
		`duplication ${result.metrics.duplication}×${DEFAULT_SCORE_WEIGHTS.duplication}=${result.metrics.duplication * DEFAULT_SCORE_WEIGHTS.duplication}`,
		`many trivial helpers ${result.metrics.manyTrivialHelpers}×${DEFAULT_SCORE_WEIGHTS.manyTrivialHelpers}=${result.metrics.manyTrivialHelpers * DEFAULT_SCORE_WEIGHTS.manyTrivialHelpers}`,
		`trivial helper depth ${result.metrics.trivialHelperDepth}×${DEFAULT_SCORE_WEIGHTS.trivialHelperDepth}=${result.metrics.trivialHelperDepth * DEFAULT_SCORE_WEIGHTS.trivialHelperDepth}`,
		`call chain ${result.metrics.callChainDepth}×${DEFAULT_SCORE_WEIGHTS.callChainDepth}=${result.metrics.callChainDepth * DEFAULT_SCORE_WEIGHTS.callChainDepth}`,
		`name length (word-based) ${result.metrics.functionNameLength}×${DEFAULT_SCORE_WEIGHTS.functionNameLength}=${result.metrics.functionNameLength * DEFAULT_SCORE_WEIGHTS.functionNameLength}`
	].join(", ");

	return [
		`   metrics: ${weightedMetricBreakdown}`,
		`   cognitive breakdown: ${formatContributionBreakdown(result.breakdown.cognitiveComplexity)}`
	];
}

function formatContributionBreakdown(result: FunctionComplexityResult["breakdown"]["cognitiveComplexity"]): string {
	if (result.length === 0) {
		return "none";
	}

	return result.map(({ line, category, impact, rule }) => `${line} ${category} +${impact}${formatContributionRule(rule)}`).join(", ");
}

function formatContributionRule(rule: FunctionComplexityResult["breakdown"]["cognitiveComplexity"][number]["rule"]): string {
	if (!rule) {
		return "";
	}

	if (rule.kind === "recursion") {
		return ` [${rule.recursionType} recursion]`;
	}

	const details = [`operators ${rule.operators.join(" → ")}`];
	if (rule.operatorChangeCount > 0) {
		details.push(`${rule.operatorChangeCount} operator change${rule.operatorChangeCount === 1 ? "" : "s"}`);
	}
	if (rule.negatedGroup) {
		details.push("negated group");
	}
	return ` [logical sequence; ${details.join(", ")}]`;
}

export function renderToolTextOutput(summary: FileComplexitySummary, options: RenderOptions = {}): string {
	return renderSummary(summary, options);
}

export function renderNotificationSummary(summary: FileComplexitySummary, options: RenderOptions = {}): string {
	return renderSummary(summary, {
		...options,
		maxOffenders: options.maxOffenders ?? DEFAULT_NOTIFY_OFFENDER_COUNT,
	});
}

function renderSummary(summary: FileComplexitySummary, options: RenderOptions): string {
	const lines = [formatFileLevelSummary(summary, options), ...formatOverallFileComplexity(summary)];

	if (summary.worstFunctions.length === 0) {
		if (summary.functionCount === 0) {
			lines.push("No supported functions were collected from this file.");
		}
		return lines.join("\n");
	}

	lines.push("", "Top offenders:");
	for (const [index, offender] of summary.worstFunctions.entries()) {
		if (index >= (options.maxOffenders ?? summary.worstFunctions.length)) {
			break;
		}
		lines.push(formatRankedOffenderLine(offender, index + 1), ...formatRankedOffenderBreakdown(offender));
	}

	return lines.join("\n");
}

function getDisplayPath(filePath: string, cwd?: string): string {
	if (!cwd) {
		return filePath;
	}

	const relativePath = path.relative(cwd, filePath);
	if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return filePath;
	}

	return relativePath;
}

function formatRatio(value: number): string {
	return value.toFixed(2);
}

function formatOptionalRatio(value: number | undefined, emptyText: string): string {
	return value === undefined ? emptyText : formatRatio(value);
}

function formatScore(score: number): string {
	return score.toFixed(1);
}
