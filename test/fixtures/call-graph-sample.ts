export function orchestrate(seed: number): number {
	return stepA(seed) + stepB(seed) + stepC(seed) + cycleEntry(seed);
}

function stepA(seed: number): number {
	return seed + 1;
}

function stepB(seed: number): number {
	return seed * 2;
}

function stepC(seed: number): number {
	return normalize(seed);
}

function normalize(seed: number): number {
	return seed - 1;
}

function cycleEntry(seed: number): number {
	return cycleNext(seed);
}

function cycleNext(seed: number): number {
	return cycleEntry(seed);
}
