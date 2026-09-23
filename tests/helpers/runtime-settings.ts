export type FakeSettings = {
	get: (key: string) => unknown;
	set: (key: string, value: unknown) => void;
	values: Record<string, unknown>;
};

export function createFakeSettings(initial: Record<string, unknown> = {}): FakeSettings {
	const values: Record<string, unknown> = { ...initial };
	return {
		values,
		get(key: string) {
			return values[key];
		},
		set(key: string, value: unknown) {
			values[key] = value;
		},
	};
}
