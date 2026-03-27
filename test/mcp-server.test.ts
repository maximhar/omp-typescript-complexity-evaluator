import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeTypeScriptFile } from "../src/analyzer.ts";
import {
	COMPLEXITY_TOOL_DESCRIPTION,
	COMPLEXITY_TOOL_NAME,
	COMPLEXITY_TOOL_TITLE,
} from "../src/complexity-tool.ts";
import { renderToolTextOutput } from "../src/render.ts";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCP_BIN_PATH = path.join(REPO_ROOT, "bin", "omp-typescript-complexity-evaluator-mcp");
const FIXTURES_DIR = path.join(REPO_ROOT, "test", "fixtures");

type ConnectedMcpClient = {
	client: Client;
	stderrChunks: string[];
};

async function connectMcpClient(): Promise<ConnectedMcpClient> {
	const transport = new StdioClientTransport({
		command: MCP_BIN_PATH,
		cwd: REPO_ROOT,
		stderr: "pipe",
	});
	const stderrChunks: string[] = [];
	const stderr = transport.stderr;
	stderr?.on("data", (chunk) => {
		stderrChunks.push(String(chunk));
	});

	const client = new Client({ name: "mcp-server-test-client", version: "1.0.0" });
	await client.connect(transport);

	return { client, stderrChunks };
}

async function closeMcpClient(connectedClient: ConnectedMcpClient): Promise<void> {
	await connectedClient.client.close();
	expect(connectedClient.stderrChunks.join("")).toBe("");
}

describe("MCP server", () => {
	let connectedClient: ConnectedMcpClient | undefined;

	afterEach(async () => {
		if (!connectedClient) {
			return;
		}

		await closeMcpClient(connectedClient);
		connectedClient = undefined;
	});

	it("lists the complexity tool with the expected metadata", async () => {
		connectedClient = await connectMcpClient();
		const result = await connectedClient.client.listTools();
		const tool = result.tools.find((candidate) => candidate.name === COMPLEXITY_TOOL_NAME);

		expect(tool).toMatchObject({
			name: COMPLEXITY_TOOL_NAME,
			title: COMPLEXITY_TOOL_TITLE,
			description: COMPLEXITY_TOOL_DESCRIPTION,
			inputSchema: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Path to the TypeScript file to analyze",
					},
				},
			},
		});
	});

	it("analyzes a fixture and returns rendered text plus structured details", async () => {
		connectedClient = await connectMcpClient();
		const expectedSummary = await analyzeTypeScriptFile(path.join(FIXTURES_DIR, "duplication-sample.ts"));
		const expectedText = renderToolTextOutput(expectedSummary, { cwd: REPO_ROOT });
		const result = await connectedClient.client.callTool({
			name: COMPLEXITY_TOOL_NAME,
			arguments: { path: "test/fixtures/duplication-sample.ts" },
		});

		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([{ type: "text", text: expectedText }]);
		expect(result.structuredContent).toMatchObject({
			renderedText: expectedText,
			summary: {
				path: path.join(FIXTURES_DIR, "duplication-sample.ts"),
				functionCount: 3,
				averageScore: 4,
				summaryScore: 2.6666666666666665,
				highestScore: 6,
			},
		});
	});

	it("returns analysis failures as tool errors instead of protocol errors", async () => {
		connectedClient = await connectMcpClient();
		const result = await connectedClient.client.callTool({
			name: COMPLEXITY_TOOL_NAME,
			arguments: { path: "test/fixtures/missing.ts" },
		});

		expect(result.isError).toBeTrue();
		expect(result.content).toEqual([
			{
				type: "text",
				text: `TypeScript file not found: ${path.join(FIXTURES_DIR, "missing.ts")}`,
			},
		]);
		expect(result.structuredContent).toBeUndefined();
	});
});
