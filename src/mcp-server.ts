import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
	analyzeRequestedPath,
	COMPLEXITY_TOOL_DESCRIPTION,
	COMPLEXITY_TOOL_NAME,
	COMPLEXITY_TOOL_PATH_DESCRIPTION,
	COMPLEXITY_TOOL_TITLE,
	getErrorMessage,
} from "./complexity-tool.ts";
import { renderToolTextOutput } from "./render.ts";
import type { FileComplexitySummary } from "./types.ts";

const MCP_SERVER_NAME = "omp-typescript-complexity-evaluator";

interface CreateComplexityMcpServerOptions {
	cwd?: string;
	version?: string;
}

type StructuredComplexityToolResult = Record<string, unknown> & {
	renderedText: string;
	summary: Record<string, unknown>;
};

export async function createComplexityMcpServer(
	options: CreateComplexityMcpServerOptions = {},
): Promise<McpServer> {
	const cwd = options.cwd ?? process.cwd();
	const server = new McpServer({
		name: MCP_SERVER_NAME,
		version: options.version ?? (await readPackageVersion()),
	});

	server.registerTool(
		COMPLEXITY_TOOL_NAME,
		{
			title: COMPLEXITY_TOOL_TITLE,
			description: COMPLEXITY_TOOL_DESCRIPTION,
			inputSchema: {
				path: z.string().describe(COMPLEXITY_TOOL_PATH_DESCRIPTION),
			},
			outputSchema: {
				renderedText: z.string(),
				summary: z.record(z.string(), z.unknown()),
			},
		},
		async ({ path: requestedPath }) => {
			try {
				const summary = await analyzeRequestedPath(requestedPath, cwd);
				const renderedText = renderToolTextOutput(summary, { cwd });

				return {
					content: [{ type: "text", text: renderedText }],
					structuredContent: buildStructuredToolResult(summary, renderedText),
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: getErrorMessage(error) }],
					isError: true,
				};
			}
		},
	);

	return server;
}

export async function startMcpStdioServer(options: CreateComplexityMcpServerOptions = {}): Promise<void> {
	const server = await createComplexityMcpServer(options);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

async function readPackageVersion(): Promise<string> {
	const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as { version?: string };
	return packageJson.version ?? "0.0.0";
}

function buildStructuredToolResult(
	summary: FileComplexitySummary,
	renderedText: string,
): StructuredComplexityToolResult {
	return {
		renderedText,
		summary: {
			path: summary.path,
			functionCount: summary.functionCount,
			highestScore: summary.highestScore,
			averageScore: summary.averageScore,
			summaryScore: summary.summaryScore,
			overallFileComplexity: summary.overallFileComplexity,
			worstFunctions: summary.worstFunctions,
			functions: summary.functions,
		},
	};
}

if (import.meta.main) {
	startMcpStdioServer().catch((error) => {
		console.error(getErrorMessage(error));
		process.exit(1);
	});
}
