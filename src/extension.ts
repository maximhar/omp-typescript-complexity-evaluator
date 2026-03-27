import {
	analyzeRequestedPath,
	COMPLEXITY_TOOL_DESCRIPTION,
	COMPLEXITY_TOOL_NAME,
	COMPLEXITY_TOOL_PATH_DESCRIPTION,
	COMPLEXITY_TOOL_TITLE,
	getErrorMessage,
} from "./complexity-tool.ts";
import { renderNotificationSummary, renderToolTextOutput } from "./render.ts";
import type { ComplexityToolParams, FileComplexitySummary } from "./types.ts";

type ToolTextContent = {
	type: "text";
	text: string;
};

interface ExtensionUIContext {
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface ToolExecutionContext {
	cwd: string;
	hasUI: boolean;
	ui: ExtensionUIContext;
}

interface CommandExecutionContext extends ToolExecutionContext {}

interface TypeBuilder {
	Object<TShape extends Record<string, unknown>>(properties: TShape): unknown;
	String(options?: { description?: string }): unknown;
}

interface ExtensionAPI {
	typebox: {
		Type: TypeBuilder;
	};
	registerTool<TDetails>(definition: {
		name: string;
		label: string;
		description: string;
		parameters: unknown;
		execute(
			toolCallId: string,
			params: ComplexityToolParams,
			signal: AbortSignal | undefined,
			onUpdate: unknown,
			ctx: ToolExecutionContext,
		): Promise<{ content: ToolTextContent[]; details?: TDetails }>;
	}): void;
	registerCommand(
		name: string,
		options: {
			description?: string;
			handler(args: string, ctx: CommandExecutionContext): Promise<void> | void;
		},
	): void;
}

const COMMAND_NAME = "complexity-score";
const COMMAND_USAGE = `Usage: /${COMMAND_NAME} <path>`;

export default function complexityExtension(pi: ExtensionAPI): void {
	const { Type } = pi.typebox;
	const toolParamsSchema = Type.Object({
		path: Type.String({ description: COMPLEXITY_TOOL_PATH_DESCRIPTION }),
	});

	pi.registerTool<FileComplexitySummary>({
		name: COMPLEXITY_TOOL_NAME,
		label: COMPLEXITY_TOOL_TITLE,
		description: COMPLEXITY_TOOL_DESCRIPTION,
		parameters: toolParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const analysis = await analyzeRequestedPath(params.path, ctx.cwd);
			return {
				content: [{ type: "text", text: renderToolTextOutput(analysis, { cwd: ctx.cwd }) }],
				details: analysis,
			};
		},
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "Analyze one TypeScript file and show the ranked complexity summary.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				throw new Error(`/${COMMAND_NAME} requires interactive mode.`);
			}

			const requestedPath = parseSinglePathArgument(args);
			if (!requestedPath) {
				ctx.ui.notify(COMMAND_USAGE, "error");
				return;
			}

			try {
				const analysis = await analyzeRequestedPath(requestedPath, ctx.cwd);
				ctx.ui.notify(renderNotificationSummary(analysis, { cwd: ctx.cwd }), "info");
			} catch (error) {
				ctx.ui.notify(getErrorMessage(error), "error");
			}
		},
	});
}


function parseSinglePathArgument(rawArgs: string): string | null {
	const tokens = parseCommandArgs(rawArgs.trim());
	if (tokens.length !== 1) {
		return null;
	}

	const [inputPath] = tokens;
	return inputPath.trim() ? inputPath : null;
}

function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (let index = 0; index < argsString.length; index += 1) {
		const char = argsString[index];
		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			inQuote = char;
			continue;
		}

		if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (current) {
		args.push(current);
	}

	return args;
}

