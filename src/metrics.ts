import * as ts from "typescript";

import { createFunctionResolutionContext, resolveCallTarget, type FunctionResolutionContext } from "./function-resolution.ts";
import type {
	ComplexityContribution,
	ComplexityContributionCategory,
	ComplexityContributionRule,
	FunctionComplexityBreakdown,
	FunctionComplexityKind,
	FunctionComplexityMetrics,
	SourceLocation,
} from "./types.ts";

export type StableFunctionNode =
	| ts.FunctionDeclaration
	| ts.MethodDeclaration
	| ts.ConstructorDeclaration
	| ts.FunctionExpression
	| ts.ArrowFunction;

export interface CollectedFunction {
	id: string;
	displayName: string;
	kind: FunctionComplexityKind;
	location: SourceLocation;
	node: StableFunctionNode;
	body: ts.ConciseBody;
	pathSegments: string[];
	classContainerId?: string;
	objectContainerName?: string;
	declarationNodes: readonly ts.Node[];
}

interface StatementFingerprint {
	key: string;
	fingerprint: string;
}

interface CollectFunctionOptions {
	classContainerId?: string;
	objectContainerName?: string;
}

interface BodyComplexityAnalysis {
	metrics: Pick<FunctionComplexityMetrics, "cognitiveComplexity" | "reassignmentCount" | "functionLoc">;
	breakdown: FunctionComplexityBreakdown;
}

export interface FunctionComplexityAnalysis {
	metrics: FunctionComplexityMetrics;
	breakdown: FunctionComplexityBreakdown;
}

export function createTypeScriptSourceFile(path: string, sourceText: string): ts.SourceFile {
	return ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, resolveScriptKind(path));
}

function resolveScriptKind(path: string): ts.ScriptKind {
	return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function collectStableFunctions(sourceFile: ts.SourceFile): CollectedFunction[] {
	const collected: CollectedFunction[] = [];

	const collectFromFunctionLike = (
		node: StableFunctionNode,
		name: string,
		kind: FunctionComplexityKind,
		ownerPath: readonly string[],
		locationNode: ts.Node,
		options: CollectFunctionOptions = {},
	): void => {
		if (!node.body) {
			return;
		}

		const pathSegments = [...ownerPath, name];
		const id = pathSegments.join(".");
		collected.push({
			id,
			displayName: id,
			kind,
			location: getSourceLocation(locationNode, sourceFile),
			node,
			body: node.body,
			pathSegments,
			classContainerId: options.classContainerId,
			objectContainerName: options.objectContainerName,
			declarationNodes: buildDeclarationNodes(node, locationNode),
		});

		visitNode(node.body, pathSegments);
	};

	const collectClassMembers = (
		classNode: ts.ClassDeclaration | ts.ClassExpression,
		classPath: readonly string[],
	): void => {
		const classId = classPath.join(".");
		for (const member of classNode.members) {
			if (ts.isConstructorDeclaration(member)) {
				if (!member.body) {
					continue;
				}
				collectFromFunctionLike(member, "constructor", "constructor", classPath, member, {
					classContainerId: classId,
				});
				continue;
			}

			if (!ts.isMethodDeclaration(member) || !member.body) {
				continue;
			}

			const methodName = getStableMemberName(member.name);
			if (!methodName) {
				continue;
			}

			collectFromFunctionLike(member, methodName, "method", classPath, member, {
				classContainerId: classId,
			});
		}
	};

	const collectObjectLiteralMethods = (
		objectLiteral: ts.ObjectLiteralExpression,
		containerName: string,
		ownerPath: readonly string[],
	): void => {
		const containerPath = [...ownerPath, containerName];
		for (const property of objectLiteral.properties) {
			if (!ts.isMethodDeclaration(property) || !property.body) {
				continue;
			}

			const methodName = getStableMemberName(property.name);
			if (!methodName) {
				continue;
			}

			collectFromFunctionLike(property, methodName, "object-method", containerPath, property, {
				objectContainerName: containerName,
			});
		}
	};

	const visitNamedVariableDeclaration = (
		declaration: ts.VariableDeclaration,
		ownerPath: readonly string[],
	): boolean => {
		if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
			return false;
		}

		const name = declaration.name.text;
		const initializer = declaration.initializer;

		if (ts.isArrowFunction(initializer)) {
			collectFromFunctionLike(initializer, name, "arrow", ownerPath, declaration);
			return true;
		}

		if (ts.isFunctionExpression(initializer)) {
			collectFromFunctionLike(initializer, name, "function-expression", ownerPath, declaration);
			return true;
		}

		if (ts.isObjectLiteralExpression(initializer)) {
			collectObjectLiteralMethods(initializer, name, ownerPath);
			return true;
		}

		if (ts.isClassExpression(initializer)) {
			collectClassMembers(initializer, [...ownerPath, name]);
			return true;
		}

		return false;
	};

	const visitNode = (node: ts.Node, ownerPath: readonly string[]): void => {
		if (ts.isFunctionDeclaration(node)) {
			if (node.name && node.body) {
				collectFromFunctionLike(node, node.name.text, "function", ownerPath, node);
			}
			return;
		}

		if (ts.isVariableDeclaration(node)) {
			if (visitNamedVariableDeclaration(node, ownerPath)) {
				return;
			}
		}

		if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
			return;
		}

		if (ts.isClassDeclaration(node)) {
			if (node.name) {
				collectClassMembers(node, [...ownerPath, node.name.text]);
			}
			return;
		}

		if (ts.isClassExpression(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
			return;
		}

		if (ts.isObjectLiteralExpression(node)) {
			for (const property of node.properties) {
				if (ts.isMethodDeclaration(property)) {
					continue;
				}
				visitNode(property, ownerPath);
			}
			return;
		}

		ts.forEachChild(node, (child) => visitNode(child, ownerPath));
	};

	visitNode(sourceFile, []);

	return collected.sort((left, right) => left.location.startLine - right.location.startLine || left.location.startColumn - right.location.startColumn || left.id.localeCompare(right.id));
}

export function computeFunctionMetrics(
	functions: readonly CollectedFunction[],
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
): Map<string, FunctionComplexityAnalysis> {
	const duplicationById = computeDuplicationByFunction(functions, sourceFile);
	const resolutionContext = createFunctionResolutionContext(functions, sourceFile, checker);
	const metricsById = new Map<string, FunctionComplexityAnalysis>();

	for (const currentFunction of functions) {
		const bodyAnalysis = computeBodyMetrics(currentFunction, sourceFile, resolutionContext);
		metricsById.set(currentFunction.id, {
			metrics: {
				...bodyAnalysis.metrics,
				duplication: duplicationById.get(currentFunction.id) ?? 0,
				manyTrivialHelpers: 0,
				trivialHelperDepth: 0,
				callChainDepth: 0,
				functionNameLength: 0,
			},
			breakdown: bodyAnalysis.breakdown,
		});
	}

	return metricsById;
}

interface CognitiveTraversalState {
	currentFunction: CollectedFunction;
	sourceFile: ts.SourceFile;
	resolutionContext: FunctionResolutionContext;
	cognitiveComplexity: number;
	reassignmentCount: number;
	breakdown: FunctionComplexityBreakdown;
}

function computeBodyMetrics(
	currentFunction: CollectedFunction,
	sourceFile: ts.SourceFile,
	resolutionContext: FunctionResolutionContext,
): BodyComplexityAnalysis {
	const state: CognitiveTraversalState = {
		currentFunction,
		sourceFile,
		resolutionContext,
		cognitiveComplexity: 0,
		reassignmentCount: 0,
		breakdown: {
			cognitiveComplexity: [],
		},
	};

	const visit = (node: ts.Node, nestingDepth: number): void => {
		if (shouldSkipComplexityTraversal(node, currentFunction)) {
			return;
		}

		if (ts.isIfStatement(node)) {
			scoreIfStatement(node, nestingDepth, state, visit);
			return;
		}

		if (isLoopStatement(node)) {
			scoreLoopStatement(node, nestingDepth, state, visit);
			return;
		}

		if (ts.isSwitchStatement(node)) {
			scoreSwitchStatement(node, nestingDepth, state, visit);
			return;
		}

		if (ts.isCatchClause(node)) {
			scoreCatchClause(node, nestingDepth, state, visit);
			return;
		}

		if (ts.isConditionalExpression(node)) {
			scoreConditionalExpression(node, nestingDepth, state, visit);
			return;
		}

		if (ts.isBinaryExpression(node) && isLogicalExpression(node) && isLogicalSequenceRoot(node)) {
			scoreLogicalExpression(node, state);
		}

		if (ts.isCallExpression(node)) {
			scoreRecursiveCall(node, state);
		}

		if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
			state.reassignmentCount += countReassignedBindings(node.left);
			visit(node.left, nestingDepth);
			visit(node.right, nestingDepth);
			return;
		}

		if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
			if (isUpdateOperator(node.operator)) {
				state.reassignmentCount += countReassignedBindings(node.operand);
			}
		}

		ts.forEachChild(node, (child) => visit(child, nestingDepth));
	};

	visit(currentFunction.body, 0);

	return {
		metrics: {
			cognitiveComplexity: state.cognitiveComplexity,
			reassignmentCount: state.reassignmentCount,
			functionLoc: computeFunctionLoc(currentFunction.body, sourceFile),
		},
		breakdown: state.breakdown,
	};
}

function shouldSkipComplexityTraversal(node: ts.Node, currentFunction: CollectedFunction): boolean {
	if (node !== currentFunction.body && isSeparateNestedExecutableBoundary(node)) {
		return true;
	}

	return node !== currentFunction.body && (ts.isClassDeclaration(node) || ts.isClassExpression(node));
}

function scoreIfStatement(
	node: ts.IfStatement,
	nestingDepth: number,
	state: CognitiveTraversalState,
	visit: (node: ts.Node, nestingDepth: number) => void,
): void {
	addCognitiveContribution(state, node, 1 + nestingDepth, "branching");
	visit(node.expression, nestingDepth);
	visit(node.thenStatement, nestingDepth + 1);
	if (!node.elseStatement) {
		return;
	}
	if (ts.isIfStatement(node.elseStatement)) {
		visit(node.elseStatement, nestingDepth);
		return;
	}
	visit(node.elseStatement, nestingDepth + 1);
}

function scoreLoopStatement(
	node: ts.IterationStatement,
	nestingDepth: number,
	state: CognitiveTraversalState,
	visit: (node: ts.Node, nestingDepth: number) => void,
): void {
	addCognitiveContribution(state, node, 1 + nestingDepth, "looping");

	if (ts.isForStatement(node)) {
		if (node.initializer) {
			visit(node.initializer, nestingDepth);
		}
		if (node.condition) {
			visit(node.condition, nestingDepth);
		}
		if (node.incrementor) {
			visit(node.incrementor, nestingDepth);
		}
		visit(node.statement, nestingDepth + 1);
		return;
	}

	if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
		visit(node.initializer, nestingDepth);
		visit(node.expression, nestingDepth);
		visit(node.statement, nestingDepth + 1);
		return;
	}

	if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
		visit(node.expression, nestingDepth);
		visit(node.statement, nestingDepth + 1);
	}
}

function scoreSwitchStatement(
	node: ts.SwitchStatement,
	nestingDepth: number,
	state: CognitiveTraversalState,
	visit: (node: ts.Node, nestingDepth: number) => void,
): void {
	addCognitiveContribution(state, node, 1 + nestingDepth, "branching");
	visit(node.expression, nestingDepth);
	for (const clause of node.caseBlock.clauses) {
		for (const statement of clause.statements) {
			visit(statement, nestingDepth + 1);
		}
	}
}

function scoreCatchClause(
	node: ts.CatchClause,
	nestingDepth: number,
	state: CognitiveTraversalState,
	visit: (node: ts.Node, nestingDepth: number) => void,
): void {
	addCognitiveContribution(state, node, 1 + nestingDepth, "exception");
	if (node.variableDeclaration) {
		visit(node.variableDeclaration, nestingDepth);
	}
	visit(node.block, nestingDepth + 1);
}

function scoreConditionalExpression(
	node: ts.ConditionalExpression,
	nestingDepth: number,
	state: CognitiveTraversalState,
	visit: (node: ts.Node, nestingDepth: number) => void,
): void {
	addCognitiveContribution(state, node, 1 + nestingDepth, "branching");
	visit(node.condition, nestingDepth);
	visit(node.whenTrue, nestingDepth + 1);
	visit(node.whenFalse, nestingDepth + 1);
}

function scoreLogicalExpression(node: ts.BinaryExpression, state: CognitiveTraversalState): void {
	const contribution = computeLogicalExpressionContribution(node);
	if (!contribution) {
		return;
	}
	addCognitiveContribution(state, contribution.node, contribution.impact, "logic", contribution.rule);
}

function scoreRecursiveCall(node: ts.CallExpression, state: CognitiveTraversalState): void {
	const resolvedTarget = resolveCallTarget(node, state.currentFunction, state.resolutionContext);
	if (resolvedTarget !== state.currentFunction.id) {
		return;
	}
	addCognitiveContribution(state, node, 1, "recursion", { kind: "recursion", recursionType: "direct" });
}

function addCognitiveContribution(
	state: CognitiveTraversalState,
	node: ts.Node,
	impact: number,
	category: ComplexityContributionCategory,
	rule?: ComplexityContributionRule,
): void {
	state.cognitiveComplexity += impact;
	recordContribution(state.breakdown.cognitiveComplexity, node, impact, category, state.sourceFile, rule);
}

function computeLogicalExpressionContribution(
	root: ts.BinaryExpression,
): { node: ts.Node; impact: number; rule: ComplexityContributionRule } | undefined {
	const operatorKinds: ts.SyntaxKind[] = [];
	collectLogicalSequence(root, operatorKinds);
	const impact = countLogicalOperatorSequenceImpact(operatorKinds);
	if (impact === 0) {
		return undefined;
	}

	return {
		node: root,
		impact,
		rule: {
			kind: "logical-sequence",
			operators: operatorKinds.map(toLogicalOperatorToken),
			operatorChangeCount: Math.max(0, impact - 1),
			negatedGroup: isNegatedGroupedLogicalRoot(root),
		},
	};
}

function collectLogicalSequence(node: ts.Expression, operatorKinds: ts.SyntaxKind[]): void {
	const unwrappedNode = unwrapParenthesizedExpression(node);
	if (getNegatedGroupedLogicalExpression(unwrappedNode)) {
		return;
	}

	if (!ts.isBinaryExpression(unwrappedNode) || !isLogicalExpression(unwrappedNode)) {
		return;
	}

	collectLogicalSequence(unwrappedNode.left, operatorKinds);
	operatorKinds.push(unwrappedNode.operatorToken.kind);
	collectLogicalSequence(unwrappedNode.right, operatorKinds);
}

function countLogicalOperatorSequenceImpact(operatorKinds: readonly ts.SyntaxKind[]): number {
	if (operatorKinds.length === 0) {
		return 0;
	}

	let impact = 1;
	let previousOperator = operatorKinds[0];
	for (const operatorKind of operatorKinds.slice(1)) {
		if (operatorKind === previousOperator) {
			continue;
		}
		impact += 1;
		previousOperator = operatorKind;
	}
	return impact;
}

function toLogicalOperatorToken(operatorKind: ts.SyntaxKind): "&&" | "||" {
	return operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||";
}

function isNegatedGroupedLogicalRoot(node: ts.BinaryExpression): boolean {
	const parent = node.parent;
	if (!ts.isParenthesizedExpression(parent)) {
		return false;
	}
	return ts.isPrefixUnaryExpression(parent.parent) && parent.parent.operator === ts.SyntaxKind.ExclamationToken;
}

function getNegatedGroupedLogicalExpression(node: ts.Expression): ts.BinaryExpression | undefined {
	if (!ts.isPrefixUnaryExpression(node) || node.operator !== ts.SyntaxKind.ExclamationToken) {
		return undefined;
	}

	if (!ts.isParenthesizedExpression(node.operand)) {
		return undefined;
	}

	const groupedExpression = unwrapParenthesizedExpression(node.operand.expression);
	if (!ts.isBinaryExpression(groupedExpression) || !isLogicalExpression(groupedExpression)) {
		return undefined;
	}

	return groupedExpression;
}

function unwrapParenthesizedExpression(node: ts.Expression): ts.Expression {
	let current = node;
	while (ts.isParenthesizedExpression(current)) {
		current = current.expression;
	}
	return current;
}

function isLogicalSequenceRoot(node: ts.BinaryExpression): boolean {
	const parent = getNearestNonParenthesizedParent(node);
	return !(parent && ts.isBinaryExpression(parent) && isLogicalExpression(parent));
}

function getNearestNonParenthesizedParent(node: ts.Node): ts.Node | undefined {
	let current = node.parent;
	while (current && ts.isParenthesizedExpression(current)) {
		current = current.parent;
	}
	return current;
}

function isLogicalExpression(node: ts.BinaryExpression): boolean {
	return node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken;
}

function recordContribution(
	target: ComplexityContribution[],
	node: ts.Node,
	impact: number,
	category: ComplexityContributionCategory,
	sourceFile: ts.SourceFile,
	rule?: ComplexityContributionRule,
): void {
	target.push({
		line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
		impact,
		category,
		rule,
	});
}

function computeFunctionLoc(body: ts.ConciseBody, sourceFile: ts.SourceFile): number {
	const { start, end } = getBodyContentSpan(body, sourceFile);
	if (start >= end) {
		return 0;
	}

	const occupiedLines = new Set<number>();

	const visit = (node: ts.Node): void => {
		if (node !== body && isSeparateNestedExecutableBoundary(node)) {
			return;
		}
		if (node !== body && (ts.isClassDeclaration(node) || ts.isClassExpression(node))) {
			return;
		}

		const children = node.getChildren(sourceFile);
		if (children.length === 0) {
			if (isTrivia(node.kind)) {
				return;
			}

			const tokenStart = Math.max(node.getStart(sourceFile), start);
			const tokenEnd = Math.min(node.end, end);
			if (tokenStart >= tokenEnd) {
				return;
			}

			const tokenLineStart = sourceFile.getLineAndCharacterOfPosition(tokenStart).line;
			const tokenLineEnd = sourceFile.getLineAndCharacterOfPosition(Math.max(tokenStart, tokenEnd - 1)).line;
			for (let line = tokenLineStart; line <= tokenLineEnd; line += 1) {
				occupiedLines.add(line);
			}
			return;
		}

		for (const child of children) {
			visit(child);
		}
	};

	visit(body);
	return occupiedLines.size;
}

function computeDuplicationByFunction(
	functions: readonly CollectedFunction[],
	sourceFile: ts.SourceFile,
): Map<string, number> {
	const duplicatedStatementsByFunction = new Map<string, Set<string>>();
	const windows = new Map<string, Array<{ functionId: string; statementKeys: string[] }>>();

	for (const currentFunction of functions) {
		duplicatedStatementsByFunction.set(currentFunction.id, new Set<string>());
		for (const sequence of collectStatementSequences(currentFunction, sourceFile)) {
			if (sequence.length < 3) {
				continue;
			}
			for (let length = 3; length <= sequence.length; length += 1) {
				for (let start = 0; start <= sequence.length - length; start += 1) {
					const windowStatements = sequence.slice(start, start + length);
					const windowKey = windowStatements.map((statement) => statement.fingerprint).join("||");
					const entries = windows.get(windowKey) ?? [];
					entries.push({
						functionId: currentFunction.id,
						statementKeys: windowStatements.map((statement) => statement.key),
					});
					windows.set(windowKey, entries);
				}
			}
		}
	}

	for (const entries of windows.values()) {
		const distinctFunctionIds = new Set(entries.map((entry) => entry.functionId));
		if (distinctFunctionIds.size < 2) {
			continue;
		}
		for (const entry of entries) {
			const duplicatedStatements = duplicatedStatementsByFunction.get(entry.functionId);
			if (!duplicatedStatements) {
				continue;
			}
			for (const statementKey of entry.statementKeys) {
				duplicatedStatements.add(statementKey);
			}
		}
	}

	const duplicationById = new Map<string, number>();
	for (const currentFunction of functions) {
		duplicationById.set(currentFunction.id, duplicatedStatementsByFunction.get(currentFunction.id)?.size ?? 0);
	}
	return duplicationById;
}

function collectStatementSequences(
	currentFunction: CollectedFunction,
	sourceFile: ts.SourceFile,
): StatementFingerprint[][] {
	if (!ts.isBlock(currentFunction.body)) {
		return [[makeExpressionFingerprint(currentFunction.body, sourceFile)]];
	}

	const sequences: StatementFingerprint[][] = [];

	const visitStatementList = (statements: readonly ts.Statement[]): void => {
		const fingerprintedStatements = statements
			.filter(isDuplicationEligibleStatement)
			.map((statement) => ({
				key: buildStatementKey(statement),
				fingerprint: normalizeNode(statement, sourceFile),
			}));
		if (fingerprintedStatements.length > 0) {
			sequences.push(fingerprintedStatements);
		}
	};

	const visit = (node: ts.Node): void => {
		if (node !== currentFunction.body && isSeparateNestedExecutableBoundary(node)) {
			return;
		}
		if (node !== currentFunction.body && (ts.isClassDeclaration(node) || ts.isClassExpression(node))) {
			return;
		}
		if (ts.isBlock(node)) {
			visitStatementList(node.statements);
		}
		if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
			visitStatementList(node.statements);
		}
		ts.forEachChild(node, visit);
	};

	visit(currentFunction.body);
	return sequences;
}

function makeExpressionFingerprint(expression: ts.Expression, sourceFile: ts.SourceFile): StatementFingerprint {
	return {
		key: buildStatementKey(expression),
		fingerprint: normalizeNode(expression, sourceFile),
	};
}

function normalizeNode(node: ts.Node, sourceFile: ts.SourceFile): string {
	const tokens: string[] = [];

	const visit = (current: ts.Node): void => {
		if (current !== node && isSeparateNestedExecutableBoundary(current)) {
			tokens.push("<fn>");
			return;
		}
		if (current !== node && (ts.isClassDeclaration(current) || ts.isClassExpression(current))) {
			tokens.push("<class>");
			return;
		}

		const children = current.getChildren(sourceFile);
		if (children.length === 0) {
			const token = normalizeLeafToken(current, sourceFile);
			if (token) {
				tokens.push(token);
			}
			return;
		}

		for (const child of children) {
			visit(child);
		}
	};

	visit(node);
	return tokens.join(" ");
}

function normalizeLeafToken(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
	if (node.kind === ts.SyntaxKind.Identifier || node.kind === ts.SyntaxKind.PrivateIdentifier) {
		return "id";
	}
	if (isLiteralKind(node.kind)) {
		return "lit";
	}
	if (isTrivia(node.kind)) {
		return undefined;
	}
	const text = node.getText(sourceFile).trim();
	return text.length > 0 ? text : undefined;
}

function getBodyContentSpan(body: ts.ConciseBody, sourceFile: ts.SourceFile): { start: number; end: number } {
	if (ts.isBlock(body)) {
		const blockStart = body.getStart(sourceFile);
		return {
			start: Math.min(body.end, blockStart + 1),
			end: Math.max(blockStart + 1, body.end - 1),
		};
	}
	return {
		start: body.getStart(sourceFile),
		end: body.end,
	};
}

function buildDeclarationNodes(node: StableFunctionNode, locationNode: ts.Node): readonly ts.Node[] {
	const declarations = new Set<ts.Node>([node, locationNode]);
	if (node.name) {
		declarations.add(node.name);
		if (ts.isPrivateIdentifier(node.name)) {
			declarations.add(node.name);
		}
	}
	return [...declarations];
}



function getStableMemberName(name: ts.PropertyName): string | undefined {
	if (ts.isComputedPropertyName(name) || ts.isPrivateIdentifier(name)) {
		return undefined;
	}
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return undefined;
}

function getSourceLocation(node: ts.Node, sourceFile: ts.SourceFile): SourceLocation {
	const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	const end = sourceFile.getLineAndCharacterOfPosition(node.end);
	return {
		startLine: start.line + 1,
		startColumn: start.character + 1,
		endLine: end.line + 1,
		endColumn: end.character + 1,
	};
}

function buildStatementKey(node: ts.Node): string {
	return `${node.pos}:${node.end}`;
}

export function isSeparateNestedExecutableBoundary(node: ts.Node): boolean {
	if (ts.isFunctionDeclaration(node)) {
		return Boolean(node.name && node.body);
	}

	if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
		return Boolean(node.body) && isStableVariableAssignedFunction(node);
	}

	if (ts.isMethodDeclaration(node)) {
		return Boolean(node.body) && isStableMethodBoundary(node);
	}

	if (ts.isConstructorDeclaration(node)) {
		return Boolean(node.body) && isStableConstructorBoundary(node);
	}

	return false;
}

function isStableVariableAssignedFunction(node: ts.FunctionExpression | ts.ArrowFunction): boolean {
	const parent = node.parent;
	return ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name);
}

function isStableMethodBoundary(node: ts.MethodDeclaration): boolean {
	if (!getStableMemberName(node.name)) {
		return false;
	}

	const parent = node.parent;
	if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
		return getStableClassContainerName(parent) !== undefined;
	}

	return ts.isObjectLiteralExpression(parent) && getStableObjectContainerName(parent) !== undefined;
}

function isStableConstructorBoundary(node: ts.ConstructorDeclaration): boolean {
	const parent = node.parent;
	return (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) && getStableClassContainerName(parent) !== undefined;
}

function getStableClassContainerName(classNode: ts.ClassDeclaration | ts.ClassExpression): string | undefined {
	if (classNode.name) {
		return classNode.name.text;
	}

	const parent = classNode.parent;
	if (ts.isVariableDeclaration(parent) && parent.initializer === classNode && ts.isIdentifier(parent.name)) {
		return parent.name.text;
	}

	return undefined;
}

function getStableObjectContainerName(objectLiteral: ts.ObjectLiteralExpression): string | undefined {
	const parent = objectLiteral.parent;
	if (ts.isVariableDeclaration(parent) && parent.initializer === objectLiteral && ts.isIdentifier(parent.name)) {
		return parent.name.text;
	}

	return undefined;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
	return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isUpdateOperator(kind: ts.PrefixUnaryOperator | ts.PostfixUnaryOperator): boolean {
	return kind === ts.SyntaxKind.PlusPlusToken || kind === ts.SyntaxKind.MinusMinusToken;
}

function countReassignedBindings(target: ts.Node): number {
	if (ts.isIdentifier(target)) {
		return 1;
	}

	if (ts.isArrayLiteralExpression(target)) {
		return target.elements.reduce((count, element) => {
			if (ts.isOmittedExpression(element)) {
				return count;
			}
			if (ts.isSpreadElement(element)) {
				return count + countReassignedBindings(element.expression);
			}
			return count + countReassignedBindings(element);
		}, 0);
	}

	if (ts.isObjectLiteralExpression(target)) {
		return target.properties.reduce((count, property) => {
			if (ts.isShorthandPropertyAssignment(property)) {
				return count + 1;
			}
			if (ts.isPropertyAssignment(property)) {
				return count + countReassignedBindings(property.initializer);
			}
			if (ts.isSpreadAssignment(property)) {
				return count + countReassignedBindings(property.expression);
			}
			return count;
		}, 0);
	}

	if (ts.isParenthesizedExpression(target)) {
		return countReassignedBindings(target.expression);
	}

	return 0;
}

function isLoopStatement(node: ts.Node): node is ts.IterationStatement {
	return (
		ts.isForStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node)
	);
}


function isTrivia(kind: ts.SyntaxKind): boolean {
	return (
		kind === ts.SyntaxKind.WhitespaceTrivia ||
		kind === ts.SyntaxKind.NewLineTrivia ||
		kind === ts.SyntaxKind.SingleLineCommentTrivia ||
		kind === ts.SyntaxKind.MultiLineCommentTrivia ||
		kind === ts.SyntaxKind.ConflictMarkerTrivia
	);
}

function isLiteralKind(kind: ts.SyntaxKind): boolean {
	return (
		kind === ts.SyntaxKind.StringLiteral ||
		kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
		kind === ts.SyntaxKind.NumericLiteral ||
		kind === ts.SyntaxKind.BigIntLiteral ||
		kind === ts.SyntaxKind.RegularExpressionLiteral ||
		kind === ts.SyntaxKind.TrueKeyword ||
		kind === ts.SyntaxKind.FalseKeyword ||
		kind === ts.SyntaxKind.NullKeyword
	);
}

function isDuplicationEligibleStatement(statement: ts.Statement): boolean {
	return !(
		ts.isFunctionDeclaration(statement) ||
		ts.isClassDeclaration(statement) ||
		ts.isInterfaceDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isEnumDeclaration(statement)
	);
}

