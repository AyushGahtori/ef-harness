/**
 * Pending poll. The inner scan matches partial index `outbox_pending`
 * (`consumer` WHERE `delivered_at IS NULL`) from schema/state.sql.
 */
export const PENDING_FOR_CONSUMER_SQL = `SELECT o.seq AS seq,
       o.id AS id,
       o.type AS type,
       o.subject AS subject,
       o.rev AS rev,
       o.payload AS payload,
       o.created_at AS created_at
  FROM (
        SELECT event_id
          FROM outbox_deliveries
         WHERE consumer = :consumer
           AND delivered_at IS NULL
       ) AS pending
  JOIN outbox AS o ON o.id = pending.event_id
 ORDER BY o.seq ASC
 LIMIT :limit`;

export const INSERT_OUTBOX_SQL = `INSERT INTO outbox(id, type, subject, rev, payload, created_at)
VALUES (:id, :type, :subject, :rev, :payload, :created_at)`;

export const SELECT_OUTBOX_BY_ID_SQL = `SELECT seq, id, type, subject, rev, payload, created_at
  FROM outbox
 WHERE id = :id`;

export const ACK_DELIVERY_SQL = `UPDATE outbox_deliveries
   SET delivered_at = :delivered_at
 WHERE event_id = :event_id
   AND consumer = :consumer
   AND delivered_at IS NULL`;

export const MIN_RETAINED_SEQ_SQL = `SELECT MIN(seq) AS seq FROM outbox`;

export const HIGH_WATER_SEQ_SQL = `SELECT seq AS seq FROM sqlite_sequence WHERE name = 'outbox'`;

export const STREAM_EPOCH_SQL = `SELECT value AS value FROM meta WHERE key = 'stream_epoch'`;

export const UNACKED_CONSUMERS_SQL = `SELECT DISTINCT consumer AS consumer
  FROM outbox_deliveries
 WHERE delivered_at IS NULL
 ORDER BY consumer ASC`;

export const CONSUMER_LAG_SQL = `SELECT d.consumer AS consumer,
       COUNT(*) AS pending,
       MIN(o.seq) AS oldest_seq,
       MIN(o.created_at) AS oldest_created_at
  FROM outbox_deliveries AS d
  JOIN outbox AS o ON o.id = d.event_id
 WHERE d.delivered_at IS NULL
 GROUP BY d.consumer
 ORDER BY d.consumer ASC`;

export const DELIVERY_STATE_SQL = `SELECT delivered_at AS delivered_at
  FROM outbox_deliveries
 WHERE event_id = :event_id AND consumer = :consumer`;

export function replaySql(topicCount: number): string {
  const topicClause =
    topicCount === 0
      ? ""
      : ` AND type IN (${Array.from({ length: topicCount }, (_, index) => `:topic_${index}`).join(", ")})`;
  return `SELECT seq, id, type, subject, rev, payload, created_at
  FROM outbox
 WHERE seq > :since_seq${topicClause}
 ORDER BY seq ASC
 LIMIT :limit`;
}
