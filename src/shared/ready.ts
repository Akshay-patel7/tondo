/**
 * The renderer marks this once the first frame has painted. The e2e suite
 * waits for the performance mark, and the smoke test waits for the console
 * line (scripts/smoke.mts repeats the string).
 */
export const READY_MARK = "tondo:ready";
