const { query } = require("../config/database");

async function initializeDatabase() {
  console.log("[Database] Initializing Email Service database...");

  await query(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      email_address VARCHAR(500) NOT NULL,
      provider VARCHAR(100) NOT NULL DEFAULT 'gmail',
      smtp_host VARCHAR(255),
      smtp_port INTEGER,
      smtp_secure BOOLEAN NOT NULL DEFAULT false,
      smtp_username VARCHAR(500),
      smtp_password TEXT,
      imap_host VARCHAR(255),
      imap_port INTEGER,
      imap_secure BOOLEAN NOT NULL DEFAULT true,
      imap_username VARCHAR(500),
      imap_password TEXT,
      imap_mailbox VARCHAR(255) NOT NULL DEFAULT 'INBOX',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_email_accounts_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_accounts_organization
    ON email_accounts(organization_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_accounts_email_address
    ON email_accounts(email_address);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_accounts_active
    ON email_accounts(is_active);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_conversations (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      email_account_id INTEGER,
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
        ),
      CONSTRAINT fk_email_conversations_email_account
        FOREIGN KEY (email_account_id)
        REFERENCES email_accounts(id)
        ON DELETE SET NULL
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_conversations_organization
    ON email_conversations(organization_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_conversations_email_account
    ON email_conversations(email_account_id);
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
        ),
      CONSTRAINT fk_communications_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES email_conversations(id)
        ON DELETE SET NULL
    );
  `);

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

  await query(`
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id SERIAL PRIMARY KEY,
      communication_id INTEGER NOT NULL,
      message_id VARCHAR(500),
      in_reply_to VARCHAR(500),
      references_header TEXT,
      provider VARCHAR(100) NOT NULL DEFAULT 'smtp',
      recipient VARCHAR(500),
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
      email_account_id INTEGER,
      mailbox VARCHAR(255) NOT NULL,
      last_processed_uid BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_email_receiver_state_account
        FOREIGN KEY (email_account_id)
        REFERENCES email_accounts(id)
        ON DELETE CASCADE
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_email_receiver_state_account_mailbox
    ON email_receiver_state(email_account_id, mailbox)
    WHERE email_account_id IS NOT NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_receiver_state_account
    ON email_receiver_state(email_account_id);
  `);

  console.log("[Database] Email Service database initialized");
}

module.exports = {
  initializeDatabase,
};
