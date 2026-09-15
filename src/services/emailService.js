const { query } = require("../config/database");
const { transporter } = require("../config/smtp");

const LEAD_SERVICE_URL =
  process.env.LEAD_SERVICE_URL || "http://lead-service:4001";

const CUSTOMER_SERVICE_URL =
  process.env.CUSTOMER_SERVICE_URL || "http://customer-service:4002";

/*
 * =========================================================
 * ERROR HELPER
 * =========================================================
 */

function createServiceError(message, statusCode = 500) {
  const error = new Error(message);

  error.statusCode = statusCode;

  return error;
}

/*
 * =========================================================
 * NORMALIZE ID
 * =========================================================
 */

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

/*
 * =========================================================
 * VALIDATE EMAIL ADDRESS
 * =========================================================
 *
 * This is intentionally a basic application-level
 * validation.
 *
 * SMTP/provider validation still happens later.
 * =========================================================
 */

function validateEmailAddress(email) {
  if (typeof email !== "string") {
    throw createServiceError("Recipient email must be a string", 400);
  }

  const normalizedEmail = email.trim();

  if (!normalizedEmail) {
    throw createServiceError("Recipient email is required", 400);
  }

  /*
   * Basic email format validation.
   */

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(normalizedEmail)) {
    throw createServiceError("Invalid recipient email address", 400);
  }

  return normalizedEmail;
}

/*
 * =========================================================
 * VALIDATE LEAD THROUGH LEAD SERVICE
 * =========================================================
 *
 * Email Service does NOT query the leads table.
 *
 * Lead Service remains the owner of lead data.
 *
 * The authenticated user's JWT is forwarded so Lead
 * Service can enforce:
 *
 *     - authentication
 *     - organization isolation
 *     - role permissions
 * =========================================================
 */

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

  /*
   * Lead does not exist or is not accessible.
   */

  if (response.status === 404) {
    throw createServiceError(`Lead ${leadId} not found`, 404);
  }

  /*
   * Authentication failure.
   */

  if (response.status === 401) {
    throw createServiceError("Lead Service rejected authentication", 401);
  }

  /*
   * Permission failure.
   */

  if (response.status === 403) {
    throw createServiceError(
      "You do not have permission to access this lead",
      403,
    );
  }

  /*
   * Other Lead Service errors.
   */

  if (!response.ok) {
    throw createServiceError(
      responseBody.error || responseBody.message || "Lead validation failed",
      response.status,
    );
  }

  /*
   * Expected response:
   *
   * {
   *   valid: true,
   *   leadId: 5,
   *   organizationId: 1
   * }
   */

  if (responseBody.valid !== true) {
    throw createServiceError(`Lead ${leadId} could not be validated`, 400);
  }

  return responseBody;
}

/*
 * =========================================================
 * VALIDATE CUSTOMER THROUGH CUSTOMER SERVICE
 * =========================================================
 *
 * Email Service does NOT query the customers table.
 *
 * Customer Service remains the owner of customer data.
 * =========================================================
 */

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

  /*
   * Customer does not exist or is not accessible.
   */

  if (response.status === 404) {
    throw createServiceError(`Customer ${customerId} not found`, 404);
  }

  /*
   * Authentication failure.
   */

  if (response.status === 401) {
    throw createServiceError("Customer Service rejected authentication", 401);
  }

  /*
   * Permission failure.
   */

  if (response.status === 403) {
    throw createServiceError(
      "You do not have permission to access this customer",
      403,
    );
  }

  /*
   * Other Customer Service errors.
   */

  if (!response.ok) {
    throw createServiceError(
      responseBody.error ||
        responseBody.message ||
        "Customer validation failed",
      response.status,
    );
  }

  /*
   * Expected response:
   *
   * {
   *   valid: true,
   *   customerId: 10,
   *   organizationId: 1
   * }
   */

  if (responseBody.valid !== true) {
    throw createServiceError(
      `Customer ${customerId} could not be validated`,
      400,
    );
  }

  return responseBody;
}

/*
 * =========================================================
 * CREATE COMMUNICATION
 * =========================================================
 *
 * PostgreSQL stores the durable communication record.
 *
 * Email Service owns this data.
 *
 * No foreign keys are created to leads/customers because
 * those records belong to other services.
 * =========================================================
 */

async function createCommunication({
  organizationId,
  leadId,
  customerId,
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
        'queued',
        $6
      )
      RETURNING *
    `,
    [
      organizationId,
      leadId || null,
      customerId || null,
      subject,
      body,
      createdBy || null,
    ],
  );

  return result.rows[0];
}

/*
 * =========================================================
 * CREATE EMAIL DELIVERY
 * =========================================================
 */

async function createEmailDelivery({ communicationId, recipient }) {
  const result = await query(
    `
      INSERT INTO email_deliveries (
        communication_id,
        recipient,
        provider,
        status
      )
      VALUES (
        $1,
        $2,
        'smtp',
        'queued'
      )
      RETURNING *
    `,
    [communicationId, recipient],
  );

  return result.rows[0];
}

/*
 * =========================================================
 * UPDATE COMMUNICATION STATUS
 * =========================================================
 */

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

/*
 * =========================================================
 * UPDATE EMAIL DELIVERY
 * =========================================================
 */

async function updateEmailDelivery({
  deliveryId,
  status,
  messageId,
  errorMessage,
}) {
  /*
   * Only set sent_at when the delivery actually reaches
   * the sent state.
   */

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

/*
 * =========================================================
 * SEND EMAIL
 * =========================================================
 *
 * Complete flow:
 *
 *     1. Validate request
 *     2. Validate Lead / Customer
 *     3. Create Communication
 *     4. Create Email Delivery
 *     5. Mark Communication as sending
 *     6. Send through SMTP
 *     7. Mark Delivery as sent
 *     8. Mark Communication as sent
 *
 * If SMTP fails:
 *
 *     Delivery       → failed
 *     Communication  → failed
 * =========================================================
 */

async function sendEmail({
  organizationId,
  userId,

  leadId,
  customerId,

  to,
  subject,

  html,
  text,

  replyTo,

  authorizationToken,
}) {
  /*
   * =======================================================
   * BASIC VALIDATION
   * =======================================================
   */

  if (!organizationId) {
    throw createServiceError("Organization context is required", 400);
  }

  const normalizedLeadId = normalizeId(leadId, "leadId");

  const normalizedCustomerId = normalizeId(customerId, "customerId");

  /*
   * A communication may belong to a lead OR customer.
   *
   * For this MVP we allow either one, or neither.
   *
   * We reject explicitly linking the same communication
   * to both entities because that makes ownership ambiguous.
   */

  if (normalizedLeadId && normalizedCustomerId) {
    throw createServiceError(
      "Specify either leadId or customerId, not both",
      400,
    );
  }

  /*
   * Recipient.
   */

  const recipient = validateEmailAddress(to);

  /*
   * Subject.
   */

  if (typeof subject !== "string" || !subject.trim()) {
    throw createServiceError("Email subject is required", 400);
  }

  const normalizedSubject = subject.trim();

  /*
   * Email content.
   */

  const hasHtml = typeof html === "string" && html.trim().length > 0;

  const hasText = typeof text === "string" && text.trim().length > 0;

  if (!hasHtml && !hasText) {
    throw createServiceError("Email content is required", 400);
  }

  const normalizedHtml = hasHtml ? html : null;

  const normalizedText = hasText ? text : null;

  /*
   * Store HTML when available; otherwise store text.
   */

  const communicationBody = normalizedHtml || normalizedText;

  /*
   * =======================================================
   * CROSS-SERVICE VALIDATION
   * =======================================================
   *
   * These calls happen BEFORE creating communication
   * records.
   */

  let validatedLead = null;
  let validatedCustomer = null;

  if (normalizedLeadId) {
    validatedLead = await validateLead(normalizedLeadId, authorizationToken);
  }

  if (normalizedCustomerId) {
    validatedCustomer = await validateCustomer(
      normalizedCustomerId,
      authorizationToken,
    );
  }

  /*
   * =======================================================
   * TENANT VALIDATION
   * =======================================================
   *
   * Make sure the downstream service agrees with the
   * authenticated organization.
   */

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

  /*
   * =======================================================
   * CREATE COMMUNICATION
   * =======================================================
   */

  const communication = await createCommunication({
    organizationId,

    leadId: normalizedLeadId,

    customerId: normalizedCustomerId,

    subject: normalizedSubject,

    body: communicationBody,

    createdBy: userId,
  });

  /*
   * =======================================================
   * CREATE EMAIL DELIVERY
   * =======================================================
   */

  const delivery = await createEmailDelivery({
    communicationId: communication.id,

    recipient,
  });

  /*
   * =======================================================
   * SMTP DELIVERY
   * =======================================================
   */

  try {
    await updateCommunicationStatus(communication.id, "sending");

    const mail = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,

      to: recipient,

      subject: normalizedSubject,

      ...(normalizedHtml
        ? {
            html: normalizedHtml,
          }
        : {}),

      ...(normalizedText
        ? {
            text: normalizedText,
          }
        : {}),

      ...(replyTo
        ? {
            replyTo,
          }
        : {}),
    };

    console.log(`[Email] Sending email to ${recipient}`);

    const result = await transporter.sendMail(mail);

    /*
     * =====================================================
     * DELIVERY SUCCESS
     * =====================================================
     */

    const updatedDelivery = await updateEmailDelivery({
      deliveryId: delivery.id,

      status: "sent",

      messageId: result.messageId,
    });

    const updatedCommunication = await updateCommunicationStatus(
      communication.id,
      "sent",
    );

    console.log(`[Email] Email sent successfully: ${result.messageId}`);

    return {
      communication: updatedCommunication,

      delivery: updatedDelivery,

      messageId: result.messageId,

      accepted: result.accepted,

      rejected: result.rejected,
    };
  } catch (error) {
    /*
     * =====================================================
     * DELIVERY FAILURE
     * =====================================================
     */

    console.error("[Email] Email delivery failed:", error);

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

/*
 * =========================================================
 * GET COMMUNICATION BY ID
 * =========================================================
 *
 * Tenant isolation is enforced using organizationId.
 * =========================================================
 */

async function getCommunicationById({ organizationId, communicationId }) {
  const normalizedCommunicationId = normalizeId(
    communicationId,
    "communicationId",
  );

  const result = await query(
    `
      SELECT
        c.*,

        ed.id AS delivery_id,
        ed.message_id,
        ed.provider,
        ed.recipient,
        ed.status AS delivery_status,
        ed.error_message,
        ed.sent_at,
        ed.delivered_at,
        ed.opened_at,
        ed.clicked_at

      FROM communications c

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

    subject: row.subject,

    body: row.body,

    status: row.status,

    createdBy: row.created_by,

    createdAt: row.created_at,

    updatedAt: row.updated_at,

    delivery: row.delivery_id
      ? {
          id: row.delivery_id,

          messageId: row.message_id,

          provider: row.provider,

          recipient: row.recipient,

          status: row.delivery_status,

          errorMessage: row.error_message,

          sentAt: row.sent_at,

          deliveredAt: row.delivered_at,

          openedAt: row.opened_at,

          clickedAt: row.clicked_at,
        }
      : null,
  };
}

/*
 * =========================================================
 * GET COMMUNICATIONS
 * =========================================================
 *
 * Optional filters:
 *
 *     leadId
 *     customerId
 *
 * Tenant isolation is ALWAYS applied.
 * =========================================================
 */

async function getCommunications({
  organizationId,
  leadId,
  customerId,
  limit = 50,
}) {
  const normalizedLeadId = normalizeId(leadId, "leadId");

  const normalizedCustomerId = normalizeId(customerId, "customerId");

  if (normalizedLeadId && normalizedCustomerId) {
    throw createServiceError(
      "Specify either leadId or customerId, not both",
      400,
    );
  }

  const values = [organizationId];

  const conditions = ["c.organization_id = $1"];

  /*
   * Lead filter.
   */

  if (normalizedLeadId) {
    values.push(normalizedLeadId);

    conditions.push(`c.lead_id = $${values.length}`);
  }

  /*
   * Customer filter.
   */

  if (normalizedCustomerId) {
    values.push(normalizedCustomerId);

    conditions.push(`c.customer_id = $${values.length}`);
  }

  /*
   * Limit.
   */

  const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  values.push(parsedLimit);

  const limitParameter = values.length;

  const result = await query(
    `
      SELECT
        c.*,

        ed.id AS delivery_id,
        ed.message_id,
        ed.provider,
        ed.recipient,
        ed.status AS delivery_status,
        ed.error_message,
        ed.sent_at

      FROM communications c

      LEFT JOIN email_deliveries ed
        ON ed.communication_id = c.id

      WHERE
        ${conditions.join(" AND ")}

      ORDER BY
        c.created_at DESC

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

    subject: row.subject,

    body: row.body,

    status: row.status,

    createdBy: row.created_by,

    createdAt: row.created_at,

    updatedAt: row.updated_at,

    delivery: row.delivery_id
      ? {
          id: row.delivery_id,

          messageId: row.message_id,

          provider: row.provider,

          recipient: row.recipient,

          status: row.delivery_status,

          errorMessage: row.error_message,

          sentAt: row.sent_at,
        }
      : null,
  }));
}

/*
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  sendEmail,
  getCommunicationById,
  getCommunications,
};
