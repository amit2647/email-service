const { query } = require("../config/database");

async function getReceiverState(organizationId, mailbox) {
  const result = await query(
    `
      SELECT
        id,
        organization_id,
        mailbox,
        last_processed_uid,
        created_at,
        updated_at
      FROM email_receiver_state
      WHERE organization_id = $1
        AND mailbox = $2
      LIMIT 1
    `,
    [organizationId, mailbox],
  );

  return result.rows[0] || null;
}

async function createReceiverState(
  organizationId,
  mailbox,
  lastProcessedUid = 0,
) {
  const result = await query(
    `
      INSERT INTO email_receiver_state (
        organization_id,
        mailbox,
        last_processed_uid
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (organization_id, mailbox)
      DO UPDATE SET
        last_processed_uid =
          email_receiver_state.last_processed_uid,
        updated_at = NOW()
      RETURNING *
    `,
    [organizationId, mailbox, lastProcessedUid],
  );

  return result.rows[0];
}

async function updateReceiverState(organizationId, mailbox, lastProcessedUid) {
  const result = await query(
    `
      UPDATE email_receiver_state
      SET
        last_processed_uid = $3,
        updated_at = NOW()
      WHERE organization_id = $1
        AND mailbox = $2
      RETURNING *
    `,
    [organizationId, mailbox, lastProcessedUid],
  );

  return result.rows[0] || null;
}

async function getOrCreateReceiverState(organizationId, mailbox) {
  const existingState = await getReceiverState(organizationId, mailbox);

  if (existingState) {
    return existingState;
  }

  return createReceiverState(organizationId, mailbox, 0);
}

module.exports = {
  getReceiverState,
  createReceiverState,
  updateReceiverState,
  getOrCreateReceiverState,
};
