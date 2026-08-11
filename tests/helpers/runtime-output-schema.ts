/**
 * OMP accepts yielded string results as model-visible exit-0 output only when
 * the native runner receives a strict non-null text outputSchema.
 *
 * Canonical form: `{ type: "string" }`.
 * Equivalents may add non-nullability constraints (e.g. minLength) but must
 * still declare `type: "string"` and must not admit null.
 */
export function isStrictTextOutputSchema(schema: unknown): boolean {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
	const record = schema as Record<string, unknown>;
	if (record.type !== "string") return false;
	if (record.nullable === true) return false;
	if (Array.isArray(record.enum) && record.enum.some((value) => value === null)) return false;
	return true;
}
