export type ComplexityBucket = "low" | "medium" | "high" | "severe";

export type FunctionComplexityKind =
	| "function"
	| "method"
	| "constructor"
	| "arrow"
	| "function-expression"
	| "object-method";

export interface SourceLocation {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export type ComplexityContributionCategory = "branching" | "looping" | "exception" | "logic" | "recursion";

export type LogicalOperatorToken = "&&" | "||";

export type ComplexityContributionRule =
	| {
		kind: "logical-sequence";
		operators: LogicalOperatorToken[];
		operatorChangeCount: number;
		negatedGroup: boolean;
	}
	| {
		kind: "recursion";
		recursionType: "direct";
	};

export interface ComplexityContribution {
	line: number;
	impact: number;
	category: ComplexityContributionCategory;
	rule?: ComplexityContributionRule;
}

export interface FunctionComplexityBreakdown {
	cognitiveComplexity: ComplexityContribution[];
}

export interface FunctionComplexityMetrics {
	cognitiveComplexity: number;
	reassignmentCount: number;
	functionLoc: number;
	duplication: number;
	manyTrivialHelpers: number;
	trivialHelperDepth: number;
	callChainDepth: number;
	functionNameLength: number;
}

export interface FunctionComplexityResult {
	id: string;
	displayName: string;
	kind: FunctionComplexityKind;
	location: SourceLocation;
	metrics: FunctionComplexityMetrics;
	breakdown: FunctionComplexityBreakdown;
	calls: string[];
	weightedScore: number;
	bucket: ComplexityBucket;
}

export interface FileComplexityMetrics {
	totalFunctionCount: number;
	eligibleFunctionCount: number;
	topLevelFunctionCount: number;
	nonTopLevelFunctionCount: number;
	helpersPerTopLevelFunction: number | undefined;
	trivialSingleUseNonTopLevelFunctionCount: number;
	trivialSingleUseNonTopLevelFunctionNames: string[];
}

export interface FileComplexityScoreComponent {
	value: number | undefined;
	weight: number;
	contribution: number;
}

export interface FileComplexityBreakdown {
	helpersPerTopLevelFunction: FileComplexityScoreComponent;
	trivialSingleUseNonTopLevelFunctions: FileComplexityScoreComponent;
}

export interface OverallFileComplexity {
	metrics: FileComplexityMetrics;
	breakdown: FileComplexityBreakdown;
	weightedScore: number;
	bucket: ComplexityBucket;
}

export interface FileComplexitySummary {
	path: string;
	functionCount: number;
	highestScore: number;
	averageScore: number;
	overallFileComplexity: OverallFileComplexity;
	worstFunctions: FunctionComplexityResult[];
	functions: FunctionComplexityResult[];
}

export interface ComplexityToolParams {
	path: string;
}

export const FUNCTION_LOC_WEIGHT_THRESHOLD = 30;

export interface ComplexityScoreWeights {
	cognitiveComplexity: number;
	reassignmentCount: number;
	functionLoc: number;
	duplication: number;
	manyTrivialHelpers: number;
	trivialHelperDepth: number;
	callChainDepth: number;
	functionNameLength: number;
}

export const DEFAULT_SCORE_WEIGHTS: ComplexityScoreWeights = {
	cognitiveComplexity: 4,
	reassignmentCount: 4,
	functionLoc: 1,
	duplication: 2,
	manyTrivialHelpers: 1,
	trivialHelperDepth: 1,
	callChainDepth: 1,
	functionNameLength: 1,
}

export interface ComplexityBucketThresholds {
	medium: number;
	high: number;
	severe: number;
}

export const DEFAULT_BUCKET_THRESHOLDS: ComplexityBucketThresholds = {
	medium: 15,
	high: 35,
	severe: 65,
};

export function getWeightedFunctionLoc(functionLoc: number): number {
	return Math.max(0, functionLoc - FUNCTION_LOC_WEIGHT_THRESHOLD);
}

export interface RankedComplexitySummary {
	path: string;
	functionCount: number;
	averageScore: number;
	highestScore: number;
	worstFunctions: FunctionComplexityResult[];
}
