/**
 * Questions are canonical `inbox_items` and `inbox_subscribers`.
 * This string must not create `qa_*` tables, a second inbox, or a second outbox.
 */
export const QUESTION_ARBITER_DDL = "";

/**
 * Interruption metrics belong in `telemetry.db` (`schema/telemetry.sql`).
 * This string must not be applied to `state.db`.
 */
export const TELEMETRY_DDL = "";
