const { query } = require("../config/database");

async function getReceiverState(emailAccountId, mailbox) {
  const result = await query(
    `
      SELECT
        id,
        email_account_id,
        mailbox,
        last_processed_uid,
        created_at,
        updated_at
      FROM email_receiver_state
      WHERE email_account_id = $1
        AND mailbox = $2
      LIMIT 1
    `,
    [emailAccountId, mailbox],
  );

  return result.rows[0] || null;
}

async function createReceiverState(
  emailAccountId,
  mailbox,
  lastProcessedUid = 0,
) {
  const result = await query(
    `
      INSERT INTO email_receiver_state (
        email_account_id,
        mailbox,
        last_processed_uid
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (email_account_id, mailbox)
      DO UPDATE SET
        last_processed_uid =
          email_receiver_state.last_processed_uid,
        updated_at = NOW()
      RETURNING *
    `,
    [emailAccountId, mailbox, lastProcessedUid],
  );

  return result.rows[0];
}

async function updateReceiverState(emailAccountId, mailbox, lastProcessedUid) {
  const result = await query(
    `
      UPDATE email_receiver_state
      SET
        last_processed_uid = $3,
        updated_at = NOW()
      WHERE email_account_id = $1
        AND mailbox = $2
      RETURNING *
    `,
    [emailAccountId, mailbox, lastProcessedUid],
  );

  return result.rows[0] || null;
}

async function getOrCreateReceiverState(emailAccountId, mailbox) {
  const existingState = await getReceiverState(emailAccountId, mailbox);

  if (existingState) {
    return existingState;
  }

  return createReceiverState(emailAccountId, mailbox, 0);
}

module.exports = {
  getReceiverState,
  createReceiverState,
  updateReceiverState,
  getOrCreateReceiverState,
};
