/**
 * OMP host version floor for omp-pstack extension initialization.
 *
 * Public seam: `ExtensionAPI.pi.VERSION` (coding-agent package index export).
 * Minimum supported host: stable `17.2.13`.
 *
 * Semver note (asserted by runtime-extension RED, not by a helper here):
 * - `17.2.13-beta.1` is < `17.2.13` and must be rejected
 * - stable `17.2.13` is accepted
 * - `17.2.14-beta.1` is > `17.2.13` under semver and may be accepted
 *
 * Do not add a suffix-stripping comparator helper — pin public init behavior only.
 */
export const MIN_OMP_CODING_AGENT_VERSION = "17.2.13";
