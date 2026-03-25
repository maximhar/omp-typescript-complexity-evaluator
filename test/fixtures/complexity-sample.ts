export function parentBoundary(values: number[]): number {
	function deepHelper(value: number): number {
		if (value > 10) {
			return value;
		}

		return value + 1;
	}

	const baseline = deepHelper(values[0] ?? 0);
	values.map((value) => value + baseline);

	return baseline + values.length;
}

export const storedArrow = (value: number): number => value + 1;

export const storedExpression = function storedExpression(value: number): number {
	return value * 2;
};

export const toolkit = {
	format(value: number): string {
		return `${value}`;
	},
};

export class Worker {
	constructor(private readonly scale: number) {}

	compute(value: number): number {
		return value * this.scale;
	}
}

export function branchy(value: number, flag: boolean, items: number[]): number {
	if (value > 10 && flag) {
		for (const item of items) {
			if (item > 0 ? true : false) {
				return item;
			}
		}
	} else if (value === 0 || flag) {
		try {
			throw new Error("boom");
		} catch (error) {
			return -1;
		}
	}

	switch (items.length) {
		case 0:
			return 0;
		case 1:
			return 1;
		default:
			return value;
	}
}

export function flatSwitch(value: number): number {
	switch (value) {
		case 0:
			return 0;
		case 1:
			return 1;
		default:
			return 2;
	}
}

export function locFixture(value: number): number {
	// comment-only lines should not count.

	const next = value + 1;
	/*
		Block comments also should not count.
	*/
	return next;
}
