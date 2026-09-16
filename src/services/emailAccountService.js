const { query } = require("../config/database");

function normalizeEmail(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value.trim().toLowerCase();
}

function normalizeAccountInput(input) {
  return {
    name: input.name?.trim(),
    emailAddress: normalizeEmail(input.emailAddress),
    provider: input.provider?.trim().toLowerCase() || "gmail",
    smtpHost: input.smtpHost?.trim() || null,
    smtpPort: input.smtpPort ? Number(input.smtpPort) : null,
    smtpSecure: Boolean(input.smtpSecure),
    smtpUsername: normalizeEmail(input.smtpUsername),
    smtpPassword: input.smtpPassword || null,
    imapHost: input.imapHost?.trim() || null,
    imapPort: input.imapPort ? Number(input.imapPort) : null,
    imapSecure:
      input.imapSecure === undefined ? true : Boolean(input.imapSecure),
    imapUsername: normalizeEmail(input.imapUsername),
    imapPassword: input.imapPassword || null,
    imapMailbox: input.imapMailbox?.trim() || "INBOX",
  };
}

function validateAccountInput(input) {
  const errors = [];

  if (!input.name) {
    errors.push("name is required");
  }

  if (!input.emailAddress) {
    errors.push("emailAddress is required");
  }

  if (!input.smtpHost) {
    errors.push("smtpHost is required");
  }

  if (!input.smtpPort) {
    errors.push("smtpPort is required");
  }

  if (!input.smtpUsername) {
    errors.push("smtpUsername is required");
  }

  if (!input.smtpPassword) {
    errors.push("smtpPassword is required");
  }

  if (!input.imapHost) {
    errors.push("imapHost is required");
  }

  if (!input.imapPort) {
    errors.push("imapPort is required");
  }

  if (!input.imapUsername) {
    errors.push("imapUsername is required");
  }

  if (!input.imapPassword) {
    errors.push("imapPassword is required");
  }

  if (!input.imapMailbox) {
    errors.push("imapMailbox is required");
  }

  if (
    input.smtpPort !== null &&
    (!Number.isInteger(input.smtpPort) ||
      input.smtpPort < 1 ||
      input.smtpPort > 65535)
  ) {
    errors.push("smtpPort must be between 1 and 65535");
  }

  if (
    input.imapPort !== null &&
    (!Number.isInteger(input.imapPort) ||
      input.imapPort < 1 ||
      input.imapPort > 65535)
  ) {
    errors.push("imapPort must be between 1 and 65535");
  }

  return errors;
}

async function createEmailAccount(organizationId, input) {
  const account = normalizeAccountInput(input);
  const errors = validateAccountInput(account);

  if (errors.length > 0) {
    const error = new Error("Invalid email account");
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  const result = await query(
    `
      INSERT INTO email_accounts (
        organization_id,
        name,
        email_address,
        provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_username,
        smtp_password,
        imap_host,
        imap_port,
        imap_secure,
        imap_username,
        imap_password,
        imap_mailbox
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15
      )
      RETURNING
        id,
        organization_id,
        name,
        email_address,
        provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_username,
        imap_host,
        imap_port,
        imap_secure,
        imap_username,
        imap_mailbox,
        is_active,
        created_at,
        updated_at
    `,
    [
      organizationId,
      account.name,
      account.emailAddress,
      account.provider,
      account.smtpHost,
      account.smtpPort,
      account.smtpSecure,
      account.smtpUsername,
      account.smtpPassword,
      account.imapHost,
      account.imapPort,
      account.imapSecure,
      account.imapUsername,
      account.imapPassword,
      account.imapMailbox,
    ],
  );

  return result.rows[0];
}

async function getEmailAccounts(organizationId) {
  const result = await query(
    `
      SELECT
        id,
        organization_id,
        name,
        email_address,
        provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_username,
        imap_host,
        imap_port,
        imap_secure,
        imap_username,
        imap_mailbox,
        is_active,
        created_at,
        updated_at
      FROM email_accounts
      WHERE organization_id = $1
      ORDER BY id ASC
    `,
    [organizationId],
  );

  return result.rows;
}

async function getEmailAccountById(organizationId, emailAccountId) {
  const result = await query(
    `
      SELECT
        id,
        organization_id,
        name,
        email_address,
        provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_username,
        smtp_password,
        imap_host,
        imap_port,
        imap_secure,
        imap_username,
        imap_password,
        imap_mailbox,
        is_active,
        created_at,
        updated_at
      FROM email_accounts
      WHERE id = $1
        AND organization_id = $2
      LIMIT 1
    `,
    [emailAccountId, organizationId],
  );

  return result.rows[0] || null;
}

async function updateEmailAccount(organizationId, emailAccountId, input) {
  const existingAccount = await getEmailAccountById(
    organizationId,
    emailAccountId,
  );

  if (!existingAccount) {
    const error = new Error("Email account not found");
    error.statusCode = 404;
    throw error;
  }

  const account = normalizeAccountInput({
    ...existingAccount,
    ...input,
  });

  const errors = validateAccountInput(account);

  if (errors.length > 0) {
    const error = new Error("Invalid email account");
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  const result = await query(
    `
      UPDATE email_accounts
      SET
        name = $1,
        email_address = $2,
        provider = $3,
        smtp_host = $4,
        smtp_port = $5,
        smtp_secure = $6,
        smtp_username = $7,
        smtp_password = $8,
        imap_host = $9,
        imap_port = $10,
        imap_secure = $11,
        imap_username = $12,
        imap_password = $13,
        imap_mailbox = $14,
        updated_at = NOW()
      WHERE id = $15
        AND organization_id = $16
      RETURNING
        id,
        organization_id,
        name,
        email_address,
        provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_username,
        imap_host,
        imap_port,
        imap_secure,
        imap_username,
        imap_mailbox,
        is_active,
        created_at,
        updated_at
    `,
    [
      account.name,
      account.emailAddress,
      account.provider,
      account.smtpHost,
      account.smtpPort,
      account.smtpSecure,
      account.smtpUsername,
      account.smtpPassword,
      account.imapHost,
      account.imapPort,
      account.imapSecure,
      account.imapUsername,
      account.imapPassword,
      account.imapMailbox,
      emailAccountId,
      organizationId,
    ],
  );

  return result.rows[0] || null;
}

async function setEmailAccountStatus(organizationId, emailAccountId, isActive) {
  const result = await query(
    `
      UPDATE email_accounts
      SET
        is_active = $1,
        updated_at = NOW()
      WHERE id = $2
        AND organization_id = $3
      RETURNING
        id,
        organization_id,
        name,
        email_address,
        provider,
        is_active,
        created_at,
        updated_at
    `,
    [Boolean(isActive), emailAccountId, organizationId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Email account not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

async function deleteEmailAccount(organizationId, emailAccountId) {
  const result = await query(
    `
      DELETE FROM email_accounts
      WHERE id = $1
        AND organization_id = $2
      RETURNING id
    `,
    [emailAccountId, organizationId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Email account not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

async function getActiveEmailAccounts() {
  const result = await query(
    `
      SELECT
        id,
        organization_id,
        name,
        email_address,
        provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_username,
        smtp_password,
        imap_host,
        imap_port,
        imap_secure,
        imap_username,
        imap_password,
        imap_mailbox,
        is_active,
        created_at,
        updated_at
      FROM email_accounts
      WHERE is_active = true
      ORDER BY id ASC
    `,
  );

  return result.rows;
}

module.exports = {
  createEmailAccount,
  getEmailAccounts,
  getEmailAccountById,
  updateEmailAccount,
  setEmailAccountStatus,
  deleteEmailAccount,
  getActiveEmailAccounts,
};
