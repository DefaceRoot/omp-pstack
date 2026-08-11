/**
 * OMP accepts yielded string results as model-visible exit-0 output only when
 * the native runner receives a strict non-null text outputSchema.
 *
 * Public ExecutorOptions shape (OMP 17.2.13 `src/task/executor.ts` ~379-382):
 * - `outputSchema?: unknown`
 * - `outputSchemaMode?: "permissive" | "strict"` (defaults to permissive)
 *
 * Canonical schema form: `{ type: "string" }`.
 * Equivalents may add non-nullability constraints (e.g. minLength) but must
 * still declare `type: "string"` and must not admit null.
 *
 * pstack_task must pass `outputSchemaMode: "strict"` alongside the schema.
 */
export function isStrictTextOutputSchema(schema: unknown): boolean {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
	const record = schema as Record<string, unknown>;
	if (record.type !== "string") return false;
	if (record.nullable === true) return false;
	if (Array.isArray(record.enum) && record.enum.some((value) => value === null)) return false;
	return true;
}

export function isStrictOutputSchemaMode(mode: unknown): boolean {
	return mode === "strict";
}
