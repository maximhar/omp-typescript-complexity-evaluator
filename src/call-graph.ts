import * as ts from "typescript";

import { createFunctionResolutionContext, resolveCallTarget } from "./function-resolution.ts";
import { isSeparateNestedExecutableBoundary, type CollectedFunction } from "./metrics.ts";
import type { FunctionComplexityMetrics } from "./types.ts";

export interface FunctionCallGraphAnalysis {
	callsByFunctionId: Map<string, string[]>;
	inboundCallCountByFunctionId: Map<string, number>;
	graphMetricsByFunctionId: Map<
		string,
		Pick<FunctionComplexityMetrics, "manyTrivialHelpers" | "trivialHelperDepth" | "callChainDepth" | "functionNameLength">
	>;
}

export function buildFunctionCallGraph(
	functions: readonly CollectedFunction[],
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	metricsByFunctionId: ReadonlyMap<string, FunctionComplexityMetrics>,
): FunctionCallGraphAnalysis {
	const resolutionContext = createFunctionResolutionContext(functions, sourceFile, checker);
	const callsByFunctionId = new Map<string, string[]>();
	const inboundCallCountByFunctionId = new Map(functions.map((currentFunction) => [currentFunction.id, 0]));

	for (const currentFunction of functions) {
		const resolvedCalls: string[] = [];
		collectCalls(currentFunction.body, currentFunction, resolutionContext, resolvedCalls);
		callsByFunctionId.set(currentFunction.id, [...new Set(resolvedCalls)].sort());
		for (const calleeId of resolvedCalls) {
			inboundCallCountByFunctionId.set(calleeId, (inboundCallCountByFunctionId.get(calleeId) ?? 0) + 1);
		}
	}

	const graphMetricsByFunctionId = new Map<
		string,
		Pick<FunctionComplexityMetrics, "manyTrivialHelpers" | "trivialHelperDepth" | "callChainDepth" | "functionNameLength">
	>();
	for (const currentFunction of functions) {
		const directCallees = callsByFunctionId.get(currentFunction.id) ?? [];
		const trivialCalleeCount = directCallees.filter((calleeId) => isTrivialFunction(metricsByFunctionId.get(calleeId))).length;
		const helperDepth = computeLongestCallDepth(currentFunction.id, callsByFunctionId, (calleeId) =>
			isTrivialFunction(metricsByFunctionId.get(calleeId)),
		);
		const callChainDepth = computeLongestCallDepth(currentFunction.id, callsByFunctionId);
		graphMetricsByFunctionId.set(currentFunction.id, {
			manyTrivialHelpers: Math.max(0, trivialCalleeCount - 2),
			trivialHelperDepth: Math.max(0, helperDepth - 1),
			callChainDepth: Math.max(0, callChainDepth - 2),
			functionNameLength: Math.max(0, countIdentifierWords(currentFunction.pathSegments.at(-1) ?? currentFunction.displayName) - 3) * 2,
		});
	}

	return {
		callsByFunctionId,
		inboundCallCountByFunctionId,
		graphMetricsByFunctionId,
	};
}

function collectCalls(
	node: ts.Node,
	currentFunction: CollectedFunction,
	resolutionContext: ReturnType<typeof createFunctionResolutionContext>,
	resolvedCalls: string[],
): void {
	if (node !== currentFunction.body && isSeparateNestedExecutableBoundary(node)) {
		return;
	}
	if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
		return;
	}
	if (ts.isCallExpression(node)) {
		const resolvedTarget = resolveCallTarget(node, currentFunction, resolutionContext);
		if (resolvedTarget) {
			resolvedCalls.push(resolvedTarget);
		}
	}
	if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
		return;
	}
	ts.forEachChild(node, (child) => collectCalls(child, currentFunction, resolutionContext, resolvedCalls));
}

function computeLongestCallDepth(
	functionId: string,
	callsByFunctionId: ReadonlyMap<string, readonly string[]>,
	predicate?: (calleeId: string) => boolean,
): number {
	const visit = (currentId: string, path: Set<string>): number => {
		let longestDepth = 0;
		for (const calleeId of callsByFunctionId.get(currentId) ?? []) {
			if (predicate && !predicate(calleeId)) {
				continue;
			}
			if (path.has(calleeId)) {
				continue;
			}
			path.add(calleeId);
			longestDepth = Math.max(longestDepth, 1 + visit(calleeId, path));
			path.delete(calleeId);
		}
		return longestDepth;
	};

	return visit(functionId, new Set([functionId]));
}

export function isTrivialFunction(metrics: FunctionComplexityMetrics | undefined): boolean {
	if (!metrics) {
		return false;
	}
	return metrics.functionLoc <= 3 && metrics.cognitiveComplexity === 0;
}

function countIdentifierWords(name: string): number {
	const normalized = name
		.replace(/[._-]+/g, " ")
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.trim();

	if (!normalized) {
		return 0;
	}

	return normalized.split(/\s+/).length;
}
