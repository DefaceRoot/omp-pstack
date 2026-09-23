/**
 * Live settings bag for runtime seam tests.
 *
 * OMP `task.maxConcurrency` contract:
 * - default when unset: 32
 * - positive N: bound concurrent native runner calls
 * - 0: unbounded
 *
 * `get` reads the current backing map so mutations after registration still apply.
 * `modelRoles` mirrors OMP's role record behind `getModelRole` / `setModelRole`.
 */
export type FakeSettings = {
	get: (key: string) => unknown;
	set: (key: string, value: unknown) => void;
	override: (key: string, value: unknown) => void;
	getModelRole: (role: string) => string | undefined;
	setModelRole: (role: string, value: string | undefined) => void;
	values: Record<string, unknown>;
	modelRoles: Record<string, string>;
};

export const DEFAULT_TASK_MAX_CONCURRENCY = 32;

export function createFakeSettings(
	initial: Record<string, unknown> = {},
	modelRoles: Record<string, string> = {},
): FakeSettings {
	const values: Record<string, unknown> = { ...initial };
	const roles: Record<string, string> = { ...modelRoles };
	return {
		values,
		modelRoles: roles,
		get(key: string) {
			return values[key];
		},
		set(key: string, value: unknown) {
			values[key] = value;
		},
		override(key: string, value: unknown) {
			values[key] = value;
		},
		getModelRole(role: string) {
			return roles[role];
		},
		setModelRole(role: string, value: string | undefined) {
			if (value === undefined) delete roles[role];
			else roles[role] = value;
		},
	};
}
