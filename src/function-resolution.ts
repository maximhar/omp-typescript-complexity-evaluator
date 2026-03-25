import * as ts from "typescript";

import type { CollectedFunction } from "./metrics.ts";

export interface FunctionResolutionContext {
	checker: ts.TypeChecker;
	sourceFile: ts.SourceFile;
	functionById: ReadonlyMap<string, CollectedFunction>;
	functionIdByNode: ReadonlyMap<ts.Node, string>;
}

export function createFunctionResolutionContext(
	functions: readonly CollectedFunction[],
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
): FunctionResolutionContext {
	return {
		checker,
		sourceFile,
		functionById: new Map(functions.map((currentFunction) => [currentFunction.id, currentFunction])),
		functionIdByNode: buildFunctionLookup(functions),
	};
}

export function resolveCallTarget(
	callExpression: ts.CallExpression,
	currentFunction: CollectedFunction,
	context: FunctionResolutionContext,
): string | undefined {
	if (callExpression.questionDotToken) {
		return undefined;
	}

	const expression = callExpression.expression;
	if (ts.isIdentifier(expression)) {
		const targetId = resolveFromSymbol(context.checker.getSymbolAtLocation(expression), context);
		if (!targetId) {
			return undefined;
		}
		const targetFunction = context.functionById.get(targetId);
		if (!targetFunction) {
			return undefined;
		}
		return isBareCallable(targetFunction.kind) ? targetId : undefined;
	}

	if (!ts.isPropertyAccessExpression(expression) || isPropertyAccessChain(expression)) {
		return undefined;
	}
	if (ts.isPrivateIdentifier(expression.name)) {
		return undefined;
	}

	const targetId = resolveFromSymbol(context.checker.getSymbolAtLocation(expression.name), context);
	if (!targetId) {
		return undefined;
	}
	const targetFunction = context.functionById.get(targetId);
	if (!targetFunction) {
		return undefined;
	}

	if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
		if (!currentFunction.classContainerId || targetFunction.classContainerId !== currentFunction.classContainerId) {
			return undefined;
		}
		return targetFunction.kind === "method" ? targetId : undefined;
	}

	if (!ts.isIdentifier(expression.expression)) {
		return undefined;
	}
	if (targetFunction.kind !== "object-method") {
		return undefined;
	}
	return targetFunction.objectContainerName === expression.expression.text ? targetId : undefined;
}

function resolveFromSymbol(
	symbol: ts.Symbol | undefined,
	context: FunctionResolutionContext,
): string | undefined {
	if (!symbol) {
		return undefined;
	}
	if ((symbol.declarations ?? []).length !== 1) {
		return undefined;
	}
	const declaration = symbol.declarations?.[0];
	if (!declaration || declaration.getSourceFile() !== context.sourceFile) {
		return undefined;
	}
	return lookupFunctionId(declaration, context.functionIdByNode);
}

function lookupFunctionId(node: ts.Node, functionIdByNode: ReadonlyMap<ts.Node, string>): string | undefined {
	let current: ts.Node | undefined = node;
	while (current) {
		const functionId = functionIdByNode.get(current);
		if (functionId) {
			return functionId;
		}
		current = current.parent;
	}
	return undefined;
}

function buildFunctionLookup(functions: readonly CollectedFunction[]): Map<ts.Node, string> {
	const functionIdByNode = new Map<ts.Node, string>();
	for (const currentFunction of functions) {
		for (const declarationNode of currentFunction.declarationNodes) {
			functionIdByNode.set(declarationNode, currentFunction.id);
		}
	}
	return functionIdByNode;
}

function isBareCallable(kind: CollectedFunction["kind"]): boolean {
	return kind === "function" || kind === "arrow" || kind === "function-expression";
}

function isPropertyAccessChain(expression: ts.PropertyAccessExpression): boolean {
	return "questionDotToken" in expression && Boolean(expression.questionDotToken);
}
