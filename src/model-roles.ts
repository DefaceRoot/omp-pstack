/**
 * P-Stack model routing expressed as OMP model roles.
 *
 * Users assign each role in `/model` → Roles; OMP persists it in `modelRoles`.
 * Each role backs one shipped agent, which `/agents` can override per agent.
 */
export const PSTACK_ROLES = [
	{ id: "pstack-judgment", name: "P-Stack Judgment", color: "accent", agent: "poteto-judgment" },
	{ id: "pstack-precise", name: "P-Stack Precise", color: "success", agent: "poteto-precise" },
	{ id: "pstack-code", name: "P-Stack Code", color: "warning", agent: "poteto-agent" },
] as const;

export type PstackRole = (typeof PSTACK_ROLES)[number];
export type PstackRoleId = PstackRole["id"];

/** `pstack_task` selector: the first assigned role whose family differs from the session model's. */
export const CROSS_FAMILY_SELECTOR = "cross-family";

const INHERIT_SELECTORS: Record<string, true> = { "": true, auto: true, "inherit-parent": true };

export function roleAlias(role: PstackRole): string {
	return `@${role.id}`;
}

export function roleForAgent(agent: string): PstackRole | undefined {
	return PSTACK_ROLES.find((role) => role.agent === agent);
}

/** Match `@pstack-<role>` with an optional `:<thinking>` suffix. */
function roleForSelector(selector: string): PstackRole | undefined {
	const base = selector.split(":", 1)[0];
	return PSTACK_ROLES.find((role) => roleAlias(role) === base);
}

export type ResolvedRoleModel = { selector: string; family: string };

export type RoleLookup = {
	sessionModel?: string;
	sessionFamily?: string;
	/** Concrete model behind an assigned role; undefined when the role is unassigned or unavailable. */
	roleModel: (role: PstackRoleId) => ResolvedRoleModel | undefined;
};

export type ResolvedSelection = {
	modelOverride?: string;
	modelRole?: PstackRoleId;
	label: string;
};

function sessionSelection(lookup: RoleLookup, reason: string): ResolvedSelection {
	return {
		modelOverride: lookup.sessionModel,
		label: lookup.sessionModel === undefined ? reason : `${reason} -> ${lookup.sessionModel}`,
	};
}

/** Map one `pstack_task` model value to the override a child runs with and its roster label. */
export function resolveSelection(model: string | undefined, lookup: RoleLookup): ResolvedSelection {
	const selector = model?.trim() ?? "";
	if (Object.hasOwn(INHERIT_SELECTORS, selector)) return sessionSelection(lookup, "inherit-parent");

	if (selector === CROSS_FAMILY_SELECTOR) {
		const assigned = PSTACK_ROLES.flatMap((role) => {
			const resolved = lookup.roleModel(role.id);
			return resolved ? [{ role, resolved }] : [];
		});
		const pick =
			assigned.find(({ resolved }) => resolved.family !== lookup.sessionFamily) ?? assigned[0];
		if (!pick) return sessionSelection(lookup, "cross-family (no P-Stack role assigned)");
		return {
			modelOverride: roleAlias(pick.role),
			modelRole: pick.role.id,
			label: `cross-family ${roleAlias(pick.role)} -> ${pick.resolved.selector}`,
		};
	}

	const role = roleForSelector(selector);
	if (!role) return { modelOverride: selector, label: selector };
	const resolved = lookup.roleModel(role.id);
	if (!resolved) return sessionSelection(lookup, `${selector} unassigned`);
	return { modelOverride: selector, modelRole: role.id, label: `${selector} -> ${resolved.selector}` };
}
