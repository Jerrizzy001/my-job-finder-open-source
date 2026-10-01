/**
 * The matching policy version.
 *
 * Stored matches record the version they were scored under. When a rule
 * changes, bump this and every stored match is re-scored on the next run.
 * `policy.test.ts` pins a hash of the rule files, so editing a rule without
 * bumping the version fails the tests.
 */
export const MATCHING_POLICY_VERSION = 'mp-1'
