const crypto = require("crypto");

const { query } = require("../config/database");
const { createSmtpTransporter } = require("../config/smtp");

const LEAD_SERVICE_URL =
  process.env.LEAD_SERVICE_URL || "http://lead-service:4001";

const CUSTOMER_SERVICE_URL =
  process.env.CUSTOMER_SERVICE_URL || "http://customer-service:4002";

function createServiceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeId(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw createServiceError(`${fieldName} must be a positive integer`, 400);
  }

  return id;
}

function validateEmailAddress(email) {
  if (typeof email !== "string") {
    throw createServiceError("Recipient email must be a string", 400);
  }

  const normalizedEmail = email.trim();

  if (!normalizedEmail) {
    throw createServiceError("Recipient email is required", 400);
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(normalizedEmail)) {
    throw createServiceError("Invalid recipient email address", 400);
  }

  return normalizedEmail;
}

function validateSubject(subject) {
  if (typeof subject !== "string" || !subject.trim()) {
    throw createServiceError("Email subject is required", 400);
  }

  return subject.trim();
}

function validateContent({ html, text }) {
  const hasHtml = typeof html === "string" && html.trim().length > 0;
  const hasText = typeof text === "string" && text.trim().length > 0;

  if (!hasHtml && !hasText) {
    throw createServiceError("Email content is required", 400);
  }

  return {
    html: hasHtml ? html : null,
    text: hasText ? text : null,
    body: hasHtml ? html : text,
  };
}

async function validateLead(leadId, authorizationToken) {
  if (!leadId) {
    return null;
  }

  if (!authorizationToken) {
    throw createServiceError("Authentication token is required", 401);
  }

  const response = await fetch(`${LEAD_SERVICE_URL}/leads/${leadId}/validate`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authorizationToken}`,
      Accept: "application/json",
    },
  });

  let responseBody = {};

  try {
    responseBody = await response.json();
  } catch (error) {
    responseBody = {};
  }

  if (response.status === 404) {
    throw createServiceError(`Lead ${leadId} not found`, 404);
  }

  if (response.status === 401) {
    throw createServiceError("Lead Service rejected authentication", 401);
  }

  if (response.status === 403) {
    throw createServiceError(
      "You do not have permission to access this lead",
      403,
    );
  }

  if (!response.ok) {
    throw createServiceError(
      responseBody.error || responseBody.message || "Lead validation failed",
      response.status,
    );
  }

  if (responseBody.valid !== true) {
    throw createServiceError(`Lead ${leadId} could not be validated`, 400);
  }

  return responseBody;
}

async function validateCustomer(customerId, authorizationToken) {
  if (!customerId) {
    return null;
  }

  if (!authorizationToken) {
    throw createServiceError("Authentication token is required", 401);
  }

  const response = await fetch(
    `${CUSTOMER_SERVICE_URL}/customers/${customerId}/validate`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authorizationToken}`,
        Accept: "application/json",
      },
    },
  );

  let responseBody = {};

  try {
    responseBody = await response.json();
  } catch (error) {
    responseBody = {};
  }

  if (response.status === 404) {
    throw createServiceError(`Customer ${customerId} not found`, 404);
  }

  if (response.status === 401) {
    throw createServiceError("Customer Service rejected authentication", 401);
  }

  if (response.status === 403) {
    throw createServiceError(
      "You do not have permission to access this customer",
      403,
    );
  }

  if (!response.ok) {
    throw createServiceError(
      responseBody.error ||
        responseBody.message ||
        "Customer validation failed",
      response.status,
    );
  }

  if (responseBody.valid !== true) {
    throw createServiceError(
      `Customer ${customerId} could not be validated`,
      400,
    );
  }

  return responseBody;
}

async function validateContact({
  organizationId,
  leadId,
  customerId,
  authorizationToken,
}) {
  if (leadId && customerId) {
    throw createServiceError(
      "Specify either leadId or customerId, not both",
      400,
    );
  }

  let validatedLead = null;
  let validatedCustomer = null;

  if (leadId) {
    validatedLead = await validateLead(leadId, authorizationToken);
  }

  if (customerId) {
    validatedCustomer = await validateCustomer(customerId, authorizationToken);
  }

  if (
    validatedLead &&
    Number(validatedLead.organizationId) !== Number(organizationId)
  ) {
    throw createServiceError(
      "Lead does not belong to the authenticated organization",
      403,
    );
  }

  if (
    validatedCustomer &&
    Number(validatedCustomer.organizationId) !== Number(organizationId)
  ) {
    throw createServiceError(
      "Customer does not belong to the authenticated organization",
      403,
    );
  }

  return {
    lead: validatedLead,
    customer: validatedCustomer,
  };
}

async function getEmailAccountById({ organizationId, emailAccountId }) {
  const normalizedEmailAccountId = normalizeId(
    emailAccountId,
    "emailAccountId",
  );

  if (!normalizedEmailAccountId) {
    throw createServiceError("Email account ID is required", 400);
  }

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
        is_active
      FROM email_accounts
      WHERE
        id = $1
        AND organization_id = $2
      LIMIT 1
    `,
    [normalizedEmailAccountId, organizationId],
  );

  if (result.rows.length === 0) {
    throw createServiceError("Email account not found", 404);
  }

  const account = result.rows[0];

  if (!account.is_active) {
    throw createServiceError("Email account is inactive", 409);
  }

  return account;
}

async function getDefaultEmailAccount(organizationId) {
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
        is_active
      FROM email_accounts
      WHERE
        organization_id = $1
        AND is_active = TRUE
      ORDER BY id ASC
    `,
    [organizationId],
  );

  if (result.rows.length === 0) {
    throw createServiceError(
      "No active email account is configured for this organization",
      409,
    );
  }

  if (result.rows.length > 1) {
    throw createServiceError(
      "Multiple active email accounts are configured. Specify emailAccountId.",
      400,
    );
  }

  return result.rows[0];
}

async function resolveEmailAccount({ organizationId, emailAccountId }) {
  const normalizedEmailAccountId = normalizeId(
    emailAccountId,
    "emailAccountId",
  );

  if (normalizedEmailAccountId) {
    return getEmailAccountById({
      organizationId,
      emailAccountId: normalizedEmailAccountId,
    });
  }

  return getDefaultEmailAccount(organizationId);
}

async function createEmailConversation({
  organizationId,
  emailAccountId,
  leadId,
  customerId,
  subject,
}) {
  const result = await query(
    `
      INSERT INTO email_conversations (
        organization_id,
        email_account_id,
        lead_id,
        customer_id,
        subject,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'open'
      )
      RETURNING *
    `,
    [
      organizationId,
      emailAccountId,
      leadId || null,
      customerId || null,
      subject,
    ],
  );

  return result.rows[0];
}

async function assignEmailAccountToConversation({
  organizationId,
  conversationId,
  emailAccountId,
}) {
  await query(
    `
      UPDATE email_conversations
      SET
        email_account_id = $1,
        updated_at = NOW()
      WHERE
        id = $2
        AND organization_id = $3
        AND email_account_id IS NULL
    `,
    [emailAccountId, conversationId, organizationId],
  );
}

async function getEmailConversationById({ organizationId, conversationId }) {
  const normalizedConversationId = normalizeId(
    conversationId,
    "conversationId",
  );

  const result = await query(
    `
      SELECT
        ec.*,
        ea.name AS email_account_name,
        ea.email_address AS email_account_address,
        ea.provider AS email_account_provider,
        ea.is_active AS email_account_active
      FROM email_conversations ec
      LEFT JOIN email_accounts ea
        ON ea.id = ec.email_account_id
      WHERE
        ec.id = $1
        AND ec.organization_id = $2
    `,
    [normalizedConversationId, organizationId],
  );

  if (result.rows.length === 0) {
    throw createServiceError("Email conversation not found", 404);
  }

  return result.rows[0];
}

async function getLatestEmailDelivery(conversationId) {
  const result = await query(
    `
      SELECT
        ed.*
      FROM email_deliveries ed
      INNER JOIN communications c
        ON c.id = ed.communication_id
      WHERE
        c.conversation_id = $1
        AND ed.message_id IS NOT NULL
      ORDER BY
        c.created_at DESC,
        ed.id DESC
      LIMIT 1
    `,
    [conversationId],
  );

  return result.rows[0] || null;
}

function generateMessageId(communicationId, sender) {
  const senderDomain =
    typeof sender === "string" && sender.includes("@")
      ? sender.split("@")[1]
      : null;

  const domain =
    process.env.EMAIL_MESSAGE_ID_DOMAIN || senderDomain || "omnicore.local";

  return `<omnicore-${communicationId}-${crypto.randomUUID()}@${domain}>`;
}

async function createCommunication({
  organizationId,
  leadId,
  customerId,
  conversationId,
  subject,
  body,
  createdBy,
}) {
  const result = await query(
    `
      INSERT INTO communications (
        organization_id,
        channel,
        direction,
        lead_id,
        customer_id,
        conversation_id,
        subject,
        body,
        status,
        created_by
      )
      VALUES (
        $1,
        'email',
        'outbound',
        $2,
        $3,
        $4,
        $5,
        $6,
        'queued',
        $7
      )
      RETURNING *
    `,
    [
      organizationId,
      leadId || null,
      customerId || null,
      conversationId || null,
      subject,
      body,
      createdBy || null,
    ],
  );

  return result.rows[0];
}

async function createEmailDelivery({
  communicationId,
  recipient,
  fromAddress,
  replyTo,
  inReplyTo,
  referencesHeader,
  messageId,
}) {
  const result = await query(
    `
      INSERT INTO email_deliveries (
        communication_id,
        message_id,
        provider,
        recipient,
        from_address,
        to_address,
        reply_to,
        in_reply_to,
        references_header,
        status
      )
      VALUES (
        $1,
        $2,
        'smtp',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        'queued'
      )
      RETURNING *
    `,
    [
      communicationId,
      messageId || null,
      recipient,
      fromAddress || null,
      recipient,
      replyTo || null,
      inReplyTo || null,
      referencesHeader || null,
    ],
  );

  return result.rows[0];
}

async function updateCommunicationStatus(communicationId, status) {
  const result = await query(
    `
      UPDATE communications
      SET
        status = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `,
    [status, communicationId],
  );

  return result.rows[0];
}

async function updateEmailDelivery({
  deliveryId,
  status,
  messageId,
  errorMessage,
}) {
  const sentAt = status === "sent" ? new Date() : null;

  const result = await query(
    `
      UPDATE email_deliveries
      SET
        status = $1,
        message_id = COALESCE($2, message_id),
        error_message = $3,
        sent_at = COALESCE($4, sent_at)
      WHERE id = $5
      RETURNING *
    `,
    [status, messageId || null, errorMessage || null, sentAt, deliveryId],
  );

  return result.rows[0];
}

async function updateConversationTimestamp(conversationId, subject) {
  await query(
    `
      UPDATE email_conversations
      SET
        updated_at = NOW(),
        subject = COALESCE($1, subject)
      WHERE id = $2
    `,
    [subject || null, conversationId],
  );
}

async function sendOutboundEmail({
  organizationId,
  userId,
  leadId,
  customerId,
  conversation,
  emailAccount,
  to,
  subject,
  html,
  text,
  replyTo,
  authorizationToken,
  inReplyTo = null,
  referencesHeader = null,
}) {
  if (Number(conversation.organization_id) !== Number(organizationId)) {
    throw createServiceError(
      "Email conversation does not belong to the authenticated organization",
      403,
    );
  }

  if (Number(conversation.email_account_id) !== Number(emailAccount.id)) {
    throw createServiceError(
      "Email account does not belong to the email conversation",
      409,
    );
  }

  const communication = await createCommunication({
    organizationId,
    leadId: leadId || conversation.lead_id || null,
    customerId: customerId || conversation.customer_id || null,
    conversationId: conversation.id,
    subject,
    body: html || text,
    createdBy: userId,
  });

  const sender = emailAccount.email_address || emailAccount.smtp_username;

  if (!sender) {
    throw createServiceError(
      "Email account sender address is not configured",
      409,
    );
  }

  const messageId = generateMessageId(communication.id, sender);

  const delivery = await createEmailDelivery({
    communicationId: communication.id,
    recipient: to,
    fromAddress: sender,
    replyTo,
    inReplyTo,
    referencesHeader,
    messageId,
  });

  try {
    await updateCommunicationStatus(communication.id, "sending");

    const mail = {
      from: sender,
      to,
      subject,
      messageId,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(referencesHeader ? { references: referencesHeader } : {}),
    };

    console.log(`[Email][Account ${emailAccount.id}] Sending email to ${to}`);

    console.log(`[Email][Account ${emailAccount.id}] From: ${sender}`);

    console.log(`[Email][Account ${emailAccount.id}] Message-ID: ${messageId}`);

    if (inReplyTo) {
      console.log(
        `[Email][Account ${emailAccount.id}] In-Reply-To: ${inReplyTo}`,
      );
    }

    const accountTransporter = createSmtpTransporter(emailAccount);

    const result = await accountTransporter.sendMail(mail);

    const finalMessageId = result.messageId || messageId;

    const updatedDelivery = await updateEmailDelivery({
      deliveryId: delivery.id,
      status: "sent",
      messageId: finalMessageId,
    });

    const updatedCommunication = await updateCommunicationStatus(
      communication.id,
      "sent",
    );

    await updateConversationTimestamp(conversation.id, subject);

    console.log(
      `[Email][Account ${emailAccount.id}] Email sent successfully: ${finalMessageId}`,
    );

    return {
      conversation: {
        id: conversation.id,
        organizationId: conversation.organization_id,
        emailAccountId: conversation.email_account_id,
        emailAccountName: emailAccount.name,
        emailAccountAddress: emailAccount.email_address,
        leadId: conversation.lead_id,
        customerId: conversation.customer_id,
        subject,
        status: conversation.status,
      },
      communication: updatedCommunication,
      delivery: updatedDelivery,
      messageId: finalMessageId,
      accepted: result.accepted,
      rejected: result.rejected,
    };
  } catch (error) {
    console.error(
      `[Email][Account ${emailAccount.id}] Email delivery failed:`,
      error,
    );

    try {
      await updateEmailDelivery({
        deliveryId: delivery.id,
        status: "failed",
        errorMessage: error.message,
      });
    } catch (updateError) {
      console.error(
        "[Email] Failed to update email delivery status:",
        updateError,
      );
    }

    try {
      await updateCommunicationStatus(communication.id, "failed");
    } catch (updateError) {
      console.error(
        "[Email] Failed to update communication status:",
        updateError,
      );
    }

    throw error;
  }
}

async function sendEmail({
  organizationId,
  userId,
  leadId,
  customerId,
  emailAccountId,
  to,
  subject,
  html,
  text,
  replyTo,
  authorizationToken,
}) {
  if (!organizationId) {
    throw createServiceError("Organization context is required", 400);
  }

  const normalizedLeadId = normalizeId(leadId, "leadId");

  const normalizedCustomerId = normalizeId(customerId, "customerId");

  const normalizedEmailAccountId = normalizeId(
    emailAccountId,
    "emailAccountId",
  );

  const recipient = validateEmailAddress(to);

  const normalizedSubject = validateSubject(subject);

  const content = validateContent({
    html,
    text,
  });

  await validateContact({
    organizationId,
    leadId: normalizedLeadId,
    customerId: normalizedCustomerId,
    authorizationToken,
  });

  const emailAccount = await resolveEmailAccount({
    organizationId,
    emailAccountId: normalizedEmailAccountId,
  });

  const conversation = await createEmailConversation({
    organizationId,
    emailAccountId: emailAccount.id,
    leadId: normalizedLeadId,
    customerId: normalizedCustomerId,
    subject: normalizedSubject,
  });

  return sendOutboundEmail({
    organizationId,
    userId,
    leadId: normalizedLeadId,
    customerId: normalizedCustomerId,
    conversation,
    emailAccount,
    to: recipient,
    subject: normalizedSubject,
    html: content.html,
    text: content.text,
    replyTo,
    authorizationToken,
  });
}

async function replyToConversation({
  organizationId,
  userId,
  conversationId,
  to,
  subject,
  html,
  text,
  replyTo,
  authorizationToken,
}) {
  if (!organizationId) {
    throw createServiceError("Organization context is required", 400);
  }

  const conversation = await getEmailConversationById({
    organizationId,
    conversationId,
  });

  if (conversation.status !== "open") {
    throw createServiceError(
      "Cannot reply to a closed or archived email conversation",
      409,
    );
  }

  let emailAccount;

  if (conversation.email_account_id) {
    emailAccount = await getEmailAccountById({
      organizationId,
      emailAccountId: conversation.email_account_id,
    });
  } else {
    emailAccount = await getDefaultEmailAccount(organizationId);

    await assignEmailAccountToConversation({
      organizationId,
      conversationId: conversation.id,
      emailAccountId: emailAccount.id,
    });

    conversation.email_account_id = emailAccount.id;

    console.log(
      `[Email] Assigned email account ${emailAccount.id} to legacy conversation ${conversation.id}`,
    );
  }

  const recipient = validateEmailAddress(to);

  const normalizedSubject = validateSubject(subject || conversation.subject);

  const content = validateContent({
    html,
    text,
  });

  const previousDelivery = await getLatestEmailDelivery(conversation.id);

  const previousMessageId = previousDelivery?.message_id || null;

  let referencesHeader = null;

  if (previousDelivery) {
    if (previousDelivery.references_header && previousDelivery.message_id) {
      referencesHeader = `${previousDelivery.references_header} ${previousDelivery.message_id}`;
    } else if (previousDelivery.message_id) {
      referencesHeader = previousDelivery.message_id;
    }
  }

  return sendOutboundEmail({
    organizationId,
    userId,
    leadId: conversation.lead_id,
    customerId: conversation.customer_id,
    conversation,
    emailAccount,
    to: recipient,
    subject: normalizedSubject,
    html: content.html,
    text: content.text,
    replyTo,
    authorizationToken,
    inReplyTo: previousMessageId,
    referencesHeader,
  });
}

async function getCommunicationById({ organizationId, communicationId }) {
  const normalizedCommunicationId = normalizeId(
    communicationId,
    "communicationId",
  );

  const result = await query(
    `
      SELECT
        c.*,
        ec.status AS conversation_status,
        ec.subject AS conversation_subject,
        ec.email_account_id,
        ea.name AS email_account_name,
        ea.email_address AS email_account_address,
        ed.id AS delivery_id,
        ed.message_id,
        ed.provider,
        ed.recipient,
        ed.from_address,
        ed.to_address,
        ed.cc_address,
        ed.reply_to,
        ed.in_reply_to,
        ed.references_header,
        ed.status AS delivery_status,
        ed.error_message,
        ed.sent_at,
        ed.delivered_at,
        ed.opened_at,
        ed.clicked_at,
        ed.received_at
      FROM communications c
      LEFT JOIN email_conversations ec
        ON ec.id = c.conversation_id
      LEFT JOIN email_accounts ea
        ON ea.id = ec.email_account_id
      LEFT JOIN email_deliveries ed
        ON ed.communication_id = c.id
      WHERE
        c.id = $1
        AND c.organization_id = $2
      ORDER BY ed.id ASC
      LIMIT 1
    `,
    [normalizedCommunicationId, organizationId],
  );

  if (result.rows.length === 0) {
    throw createServiceError("Communication not found", 404);
  }

  const row = result.rows[0];

  return {
    id: row.id,
    organizationId: row.organization_id,
    channel: row.channel,
    direction: row.direction,
    leadId: row.lead_id,
    customerId: row.customer_id,
    conversationId: row.conversation_id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    conversation: row.conversation_id
      ? {
          id: row.conversation_id,
          status: row.conversation_status,
          subject: row.conversation_subject,
          emailAccountId: row.email_account_id,
          emailAccountName: row.email_account_name,
          emailAccountAddress: row.email_account_address,
        }
      : null,
    delivery: row.delivery_id
      ? {
          id: row.delivery_id,
          messageId: row.message_id,
          provider: row.provider,
          recipient: row.recipient,
          fromAddress: row.from_address,
          toAddress: row.to_address,
          ccAddress: row.cc_address,
          replyTo: row.reply_to,
          inReplyTo: row.in_reply_to,
          references: row.references_header,
          status: row.delivery_status,
          errorMessage: row.error_message,
          sentAt: row.sent_at,
          deliveredAt: row.delivered_at,
          openedAt: row.opened_at,
          clickedAt: row.clicked_at,
          receivedAt: row.received_at,
        }
      : null,
  };
}

async function getCommunications({
  organizationId,
  leadId,
  customerId,
  conversationId,
  limit = 50,
}) {
  const normalizedLeadId = normalizeId(leadId, "leadId");

  const normalizedCustomerId = normalizeId(customerId, "customerId");

  const normalizedConversationId = normalizeId(
    conversationId,
    "conversationId",
  );

  if (normalizedLeadId && normalizedCustomerId) {
    throw createServiceError(
      "Specify either leadId or customerId, not both",
      400,
    );
  }

  const values = [organizationId];

  const conditions = ["c.organization_id = $1"];

  if (normalizedLeadId) {
    values.push(normalizedLeadId);

    conditions.push(`c.lead_id = $${values.length}`);
  }

  if (normalizedCustomerId) {
    values.push(normalizedCustomerId);

    conditions.push(`c.customer_id = $${values.length}`);
  }

  if (normalizedConversationId) {
    values.push(normalizedConversationId);

    conditions.push(`c.conversation_id = $${values.length}`);
  }

  const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  values.push(parsedLimit);

  const limitParameter = values.length;

  const result = await query(
    `
      SELECT
        c.*,
        ec.email_account_id,
        ea.name AS email_account_name,
        ea.email_address AS email_account_address,
        ed.id AS delivery_id,
        ed.message_id,
        ed.provider,
        ed.recipient,
        ed.from_address,
        ed.to_address,
        ed.cc_address,
        ed.reply_to,
        ed.in_reply_to,
        ed.references_header,
        ed.status AS delivery_status,
        ed.error_message,
        ed.sent_at,
        ed.delivered_at,
        ed.received_at
      FROM communications c
      LEFT JOIN email_conversations ec
        ON ec.id = c.conversation_id
      LEFT JOIN email_accounts ea
        ON ea.id = ec.email_account_id
      -- Lateral, not a plain join: a communication with more than one delivery
      -- row would otherwise appear once per delivery and duplicate the message
      -- in the thread. getCommunicationById avoids this with LIMIT 1, which is
      -- not available here because this query returns many communications.
      LEFT JOIN LATERAL (
        SELECT *
        FROM email_deliveries d
        WHERE d.communication_id = c.id
        ORDER BY d.id ASC
        LIMIT 1
      ) ed ON TRUE
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT $${limitParameter}
    `,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    channel: row.channel,
    direction: row.direction,
    leadId: row.lead_id,
    customerId: row.customer_id,
    conversationId: row.conversation_id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    conversation: row.conversation_id
      ? {
          id: row.conversation_id,
          emailAccountId: row.email_account_id,
          emailAccountName: row.email_account_name,
          emailAccountAddress: row.email_account_address,
        }
      : null,
    delivery: row.delivery_id
      ? {
          id: row.delivery_id,
          messageId: row.message_id,
          provider: row.provider,
          recipient: row.recipient,
          fromAddress: row.from_address,
          toAddress: row.to_address,
          ccAddress: row.cc_address,
          replyTo: row.reply_to,
          inReplyTo: row.in_reply_to,
          references: row.references_header,
          status: row.delivery_status,
          errorMessage: row.error_message,
          sentAt: row.sent_at,
          deliveredAt: row.delivered_at,
          receivedAt: row.received_at,
        }
      : null,
  }));
}

module.exports = {
  sendEmail,
  replyToConversation,
  getCommunicationById,
  getCommunications,
  getEmailConversationById,
  getLatestEmailDelivery,
};
