const { query } = require("../config/database");

async function initializeDatabase() {
  console.log("[Database] Initializing Email Service database...");

  await query(`
    CREATE TABLE IF NOT EXISTS communications (
      id SERIAL PRIMARY KEY,

      organization_id INTEGER NOT NULL,

      channel VARCHAR(50) NOT NULL,
      direction VARCHAR(20) NOT NULL,

      lead_id INTEGER,
      customer_id INTEGER,

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
    CREATE INDEX IF NOT EXISTS idx_communications_created_at
    ON communications(created_at DESC);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id SERIAL PRIMARY KEY,

      communication_id INTEGER NOT NULL,

      message_id VARCHAR(500),

      provider VARCHAR(100) NOT NULL DEFAULT 'smtp',

      recipient VARCHAR(500) NOT NULL,

      status VARCHAR(50) NOT NULL DEFAULT 'queued',

      error_message TEXT,

      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,

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
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_status
    ON email_deliveries(status);
  `);

  console.log("[Database] Email Service database initialized");
}

module.exports = {
  initializeDatabase,
};
