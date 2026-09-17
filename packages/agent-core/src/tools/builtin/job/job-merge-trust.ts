/**
 * MergeJob trust rules — implementation lives in `./merge/trust`.
 * Kept as a thin public entry so existing imports of `job-merge-trust` stay stable
 * while the job/ directory stays within the flat .ts dir budget.
 */
export * from './merge/trust';
