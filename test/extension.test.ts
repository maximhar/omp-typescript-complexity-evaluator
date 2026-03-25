import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeTypeScriptFile } from "../src/analyzer.ts";
import complexityExtension from "../src/extension.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

type ToolDefinition = {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	execute: (
		toolCallId: string,
		params: { path: string },
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: {
			cwd: string;
			hasUI: boolean;
			ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
		},
	) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown }>;
};

type CommandDefinition = {
	name: string;
	description?: string;
	handler: (args: string, ctx: {
		cwd: string;
		hasUI: boolean;
		ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
	}) => Promise<void> | void;
};

function registerExtension() {
	let tool: ToolDefinition | undefined;
	let command: CommandDefinition | undefined;

	complexityExtension({
		typebox: {
			Type: {
				Object(properties: Record<string, unknown>) {
					return { type: "object", properties };
				},
				String(options: { description?: string } = {}) {
					return { type: "string", ...options };
				},
			},
		},
		registerTool(definition: ToolDefinition) {
			tool = definition;
		},
		registerCommand(name: string, options: { description?: string; handler: CommandDefinition["handler"] }) {
			command = { name, ...options };
		},
	});

	if (!tool || !command) {
		throw new Error("Extension registration did not complete.");
	}

	return { command, tool };
}

function createNotifyRecorder() {
	const calls: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
	return {
		calls,
		notify(message: string, type?: "info" | "warning" | "error") {
			calls.push({ message, type });
		},
	};
}

describe("complexity extension", () => {
	it("registers the tool and command with the expected shape", () => {
		const { command, tool } = registerExtension();

		expect(tool).toMatchObject({
			name: "score_typescript_complexity",
			label: "TypeScript Complexity Score",
			description: "Analyze one TypeScript file and report ranked function complexity offenders.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Path to the TypeScript file to analyze",
					},
				},
			},
		});
		expect(command).toMatchObject({
			name: "complexity-score",
			description: "Analyze one TypeScript file and show the ranked complexity summary.",
		});
	});

	it("executes the tool against a cwd-relative path and returns text plus details", async () => {
		const { tool } = registerExtension();
		const fixturePath = path.join(FIXTURES_DIR, "duplication-sample.ts");
		const expectedSummary = await analyzeTypeScriptFile(fixturePath);
		const ui = createNotifyRecorder();

		const result = await tool.execute(
			"tool-call-1",
			{ path: "duplication-sample.ts" },
			undefined,
			undefined,
			{
				cwd: FIXTURES_DIR,
				hasUI: true,
				ui,
			},
		);

		expect(result.details).toEqual(expectedSummary);
		expect(result.content).toEqual([
			{
				type: "text",
				text: `TypeScript complexity summary for duplication-sample.ts\nfunctions: 3 | average weighted score: 4.0 | highest weighted score: 6.0\nranked offenders: 3\noverall file complexity: [low] score 0.0\nfile score breakdown: helpers per top-level function 0.00×2.0=0.0, trivial single-use non-top-level functions 0×4.0=0.0\nfile metrics: top-level functions 3/3, non-top-level functions 0/3, helpers per top-level function 0.00, trivial single-use non-top-level functions 0\ntrivial helper contributors: none\n\nTop offenders:\n1. normalizeOrders (function) [low] score 6.0 @ 1:1-5:2\n   metrics: cognitive 0×4=0, reassignments 0×4=0, loc max(0, 3-30)=0×1=0, duplication 3×2=6, many trivial helpers 0×1=0, trivial helper depth 0×1=0, call chain 0×1=0, name length (word-based) 0×1=0\n   cognitive breakdown: none\n2. normalizeInvoices (function) [low] score 6.0 @ 7:1-11:2\n   metrics: cognitive 0×4=0, reassignments 0×4=0, loc max(0, 3-30)=0×1=0, duplication 3×2=6, many trivial helpers 0×1=0, trivial helper depth 0×1=0, call chain 0×1=0, name length (word-based) 0×1=0\n   cognitive breakdown: none\n3. uniqueProcess (function) [low] score 0.0 @ 13:1-17:2\n   metrics: cognitive 0×4=0, reassignments 0×4=0, loc max(0, 3-30)=0×1=0, duplication 0×2=0, many trivial helpers 0×1=0, trivial helper depth 0×1=0, call chain 0×1=0, name length (word-based) 0×1=0\n   cognitive breakdown: none`,
			},
		]);
		expect(result.content[0]?.text).not.toContain("nesting ");
		expect(ui.calls).toEqual([]);
	});

	it("uses the same analyzer and renderer behavior for command success notifications", async () => {
		const { command, tool } = registerExtension();
		const ui = createNotifyRecorder();

		const toolResult = await tool.execute(
			"tool-call-2",
			{ path: "duplication-sample.ts" },
			undefined,
			undefined,
			{
				cwd: FIXTURES_DIR,
				hasUI: true,
				ui,
			},
		);
		await command.handler("duplication-sample.ts", {
			cwd: FIXTURES_DIR,
			hasUI: true,
			ui,
		});

		expect(ui.calls).toEqual([{ message: toolResult.content[0]?.text ?? "", type: "info" }]);
	});

	it("notifies usage and analyzer errors truthfully", async () => {
		const { command } = registerExtension();
		const usageUi = createNotifyRecorder();
		const errorUi = createNotifyRecorder();

		await command.handler("", {
			cwd: FIXTURES_DIR,
			hasUI: true,
			ui: usageUi,
		});
		await command.handler("missing.ts", {
			cwd: FIXTURES_DIR,
			hasUI: true,
			ui: errorUi,
		});

		expect(usageUi.calls).toEqual([{ message: "Usage: /complexity-score <path>", type: "error" }]);
		expect(errorUi.calls).toEqual([
			{ message: `TypeScript file not found: ${path.join(FIXTURES_DIR, "missing.ts")}`, type: "error" },
		]);
	});

	it("requires interactive mode for the command", async () => {
		const { command } = registerExtension();
		const ui = createNotifyRecorder();

		await expect(
			command.handler("duplication-sample.ts", {
				cwd: FIXTURES_DIR,
				hasUI: false,
				ui,
			}),
		).rejects.toThrow("/complexity-score requires interactive mode.");
		expect(ui.calls).toEqual([]);
	});
});
