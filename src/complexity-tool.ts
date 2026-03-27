import * as path from "node:path";

import { analyzeTypeScriptFile } from "./analyzer.ts";
import type { FileComplexitySummary } from "./types.ts";

export const COMPLEXITY_TOOL_NAME = "score_typescript_complexity";
export const COMPLEXITY_TOOL_TITLE = "TypeScript Complexity Score";
export const COMPLEXITY_TOOL_DESCRIPTION = "Analyze one TypeScript file and report ranked function complexity offenders.";
export const COMPLEXITY_TOOL_PATH_DESCRIPTION = "Path to the TypeScript file to analyze";

export async function analyzeRequestedPath(inputPath: string, cwd: string): Promise<FileComplexitySummary> {
	const resolvedPath = path.resolve(cwd, inputPath.trim());
	return analyzeTypeScriptFile(resolvedPath);
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
