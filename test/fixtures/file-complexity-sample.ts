export function runScenario(input: number): number {
	const normalized = parseInput(input);
	return assembleResult(normalized) + sharedBoost(normalized);
}

function parseInput(input: number): number {
	return clampValue(input);
}

function assembleResult(value: number): number {
	return sharedBoost(value) + computeOffset(value);
}

function clampValue(input: number): number {
	if (input < 0) {
		return 0;
	}

	return input;
}

function sharedBoost(value: number): number {
	return value * 2;
}

function computeOffset(value: number): number {
	return inlineAdjustment(value);
}

function inlineAdjustment(value: number): number {
	return value - 1;
}
