/**
 * Live settings bag for runtime seam tests.
 *
 * OMP `task.maxConcurrency` contract:
 * - default when unset: 32
 * - positive N: bound concurrent native runner calls
 * - 0: unbounded
 *
 * `get` reads the current backing map so mutations after registration still apply.
 */
export type FakeSettings = {
	get: (key: string) => unknown;
	set: (key: string, value: unknown) => void;
	values: Record<string, unknown>;
};

export const DEFAULT_TASK_MAX_CONCURRENCY = 32;

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
