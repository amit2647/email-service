const { query } = require("../config/database");

async function initializeDatabase() {
  console.log("[Database] Initializing Email Service database...");

  /*
   * ============================================================
   * EMAIL CONVERSATIONS
   * ============================================================
   *
   * Represents an email thread/conversation.
   *
   * Example:
   *
   * Conversation 42
   *   ├── Communication 101 - outbound
   *   ├── Communication 102 - inbound
   *   ├── Communication 103 - outbound
   *   └── Communication 104 - inbound
   *
   */

  await query(`
    CREATE TABLE IF NOT EXISTS email_conversations (
      id SERIAL PRIMARY KEY,

      organization_id INTEGER NOT NULL,

      lead_id INTEGER,
      customer_id INTEGER,

      subject VARCHAR(500),

      status VARCHAR(50) NOT NULL DEFAULT 'open',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT email_conversations_status_check
        CHECK (
          status IN (
            'open',
            'closed',
            'archived'
          )
        )
    );
  `);

  /*
   * ============================================================
   * EMAIL CONVERSATION INDEXES
   * ============================================================
   */

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_conversations_organization
    ON email_conversations(organization_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_conversations_lead
    ON email_conversations(lead_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_conversations_customer
    ON email_conversations(customer_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_conversations_updated_at
    ON email_conversations(updated_at DESC);
  `);

  /*
   * ============================================================
   * COMMUNICATIONS
   * ============================================================
   */

  await query(`
    CREATE TABLE IF NOT EXISTS communications (
      id SERIAL PRIMARY KEY,

      organization_id INTEGER NOT NULL,

      channel VARCHAR(50) NOT NULL,
      direction VARCHAR(20) NOT NULL,

      lead_id INTEGER,
      customer_id INTEGER,

      conversation_id INTEGER,

      subject VARCHAR(500),
      body TEXT,

      status VARCHAR(50) NOT NULL DEFAULT 'queued',

      created_by INTEGER,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT communications_channel_check
        CHECK (
          channel IN (
            'email',
            'sms',
            'phone',
            'whatsapp',
            'internal_note'
          )
        ),

      CONSTRAINT communications_direction_check
        CHECK (
          direction IN (
            'inbound',
            'outbound'
          )
        ),

      CONSTRAINT communications_status_check
        CHECK (
          status IN (
            'queued',
            'sending',
            'sent',
            'delivered',
            'failed',
            'cancelled'
          )
        )
    );
  `);

  /*
   * ============================================================
   * EXISTING DATABASE MIGRATION
   * ============================================================
   *
   * If communications already exists from the previous version,
   * add conversation_id without destroying existing data.
   */

  await query(`
    ALTER TABLE communications
    ADD COLUMN IF NOT EXISTS conversation_id INTEGER;
  `);

  /*
   * ============================================================
   * COMMUNICATION -> CONVERSATION FOREIGN KEY
   * ============================================================
   *
   * We add the FK only if it does not already exist.
   */

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_communications_conversation'
      ) THEN

        ALTER TABLE communications
        ADD CONSTRAINT fk_communications_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES email_conversations(id)
        ON DELETE SET NULL;

      END IF;
    END
    $$;
  `);

  /*
   * ============================================================
   * COMMUNICATION INDEXES
   * ============================================================
   */

  await query(`
    CREATE INDEX IF NOT EXISTS idx_communications_organization
    ON communications(organization_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_communications_lead
    ON communications(lead_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_communications_customer
    ON communications(customer_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_communications_conversation
    ON communications(conversation_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_communications_created_at
    ON communications(created_at DESC);
  `);

  /*
   * ============================================================
   * EMAIL DELIVERIES
   * ============================================================
   */

  await query(`
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id SERIAL PRIMARY KEY,

      communication_id INTEGER NOT NULL,

      message_id VARCHAR(500),

      in_reply_to VARCHAR(500),

      references_header TEXT,

      provider VARCHAR(100) NOT NULL DEFAULT 'smtp',

      recipient VARCHAR(500) NOT NULL,

      from_address VARCHAR(500),

      to_address VARCHAR(1000),

      cc_address VARCHAR(1000),

      reply_to VARCHAR(500),

      status VARCHAR(50) NOT NULL DEFAULT 'queued',

      error_message TEXT,

      sent_at TIMESTAMPTZ,

      delivered_at TIMESTAMPTZ,

      opened_at TIMESTAMPTZ,

      clicked_at TIMESTAMPTZ,

      received_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT fk_email_delivery_communication
        FOREIGN KEY (communication_id)
        REFERENCES communications(id)
        ON DELETE CASCADE
    );
  `);

  /*
   * ============================================================
   * EXISTING DATABASE MIGRATION
   * ============================================================
   *
   * The table may already exist with the older schema.
   * Add the new inbound-email columns safely.
   */

  await query(`
    ALTER TABLE email_deliveries
    ADD COLUMN IF NOT EXISTS in_reply_to VARCHAR(500);
  `);

  await query(`
    ALTER TABLE email_deliveries
    ADD COLUMN IF NOT EXISTS references_header TEXT;
  `);

  await query(`
    ALTER TABLE email_deliveries
    ADD COLUMN IF NOT EXISTS from_address VARCHAR(500);
  `);

  await query(`
    ALTER TABLE email_deliveries
    ADD COLUMN IF NOT EXISTS to_address VARCHAR(1000);
  `);

  await query(`
    ALTER TABLE email_deliveries
    ADD COLUMN IF NOT EXISTS cc_address VARCHAR(1000);
  `);

  await query(`
    ALTER TABLE email_deliveries
    ADD COLUMN IF NOT EXISTS reply_to VARCHAR(500);
  `);

  await query(`
    ALTER TABLE email_deliveries
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
  `);

  /*
   * ============================================================
   * EMAIL DELIVERY INDEXES
   * ============================================================
   */

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_communication
    ON email_deliveries(communication_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_message_id
    ON email_deliveries(message_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_in_reply_to
    ON email_deliveries(in_reply_to);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_status
    ON email_deliveries(status);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_received_at
    ON email_deliveries(received_at DESC);
  `);

  await query(`
  CREATE TABLE IF NOT EXISTS email_receiver_state (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    mailbox VARCHAR(255) NOT NULL,
    last_processed_uid BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_email_receiver_state
      UNIQUE (organization_id, mailbox)
  );
`);

  await query(`
  CREATE INDEX IF NOT EXISTS idx_email_receiver_state_organization
  ON email_receiver_state (organization_id);
`);

  console.log("[Database] Email Service database initialized");
}

module.exports = {
  initializeDatabase,
};
