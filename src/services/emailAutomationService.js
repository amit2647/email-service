const { query } = require("../config/database");

const TRIGGER_EVENTS = ["lead.created", "lead.converted", "customer.created"];

const MAX_ATTEMPTS = 5;

const AUTOMATION_COLUMNS = `
  id,
  organization_id,
  name,
  description,
  trigger_event,
  template_id,
  email_account_id,
  is_active,
  created_at,
  updated_at
`;

const EVENT_COLUMNS = `
  id,
  organization_id,
  event,
  payload,
  dedupe_key,
  status,
  attempts,
  next_attempt_at,
  last_error,
  created_at,
  processed_at
`;

function normalizeAutomationInput(input) {
  return {
    name: input.name?.trim(),
    description: input.description?.trim() || null,
    triggerEvent: input.trigger_event?.trim(),
    templateId: input.template_id ? Number(input.template_id) : null,
    emailAccountId: input.email_account_id ? Number(input.email_account_id) : null,
    isActive: input.is_active === undefined ? false : Boolean(input.is_active),
  };
}

function validateAutomationInput(input) {
  const errors = [];

  if (!input.name) {
    errors.push("name is required");
  }

  if (!input.triggerEvent) {
    errors.push("trigger_event is required");
  } else if (!TRIGGER_EVENTS.includes(input.triggerEvent)) {
    errors.push(`trigger_event must be one of: ${TRIGGER_EVENTS.join(", ")}`);
  }

  if (!Number.isInteger(input.templateId) || input.templateId <= 0) {
    errors.push("template_id is required");
  }

  return errors;
}

async function listAutomations(organizationId) {
  const result = await query(
    `SELECT a.id, a.organization_id, a.name, a.description, a.trigger_event,
            a.template_id, a.email_account_id, a.is_active,
            a.created_at, a.updated_at,
            t.name AS template_name
     FROM email_automations a
     LEFT JOIN email_templates t ON t.id = a.template_id
     WHERE a.organization_id = $1
     ORDER BY a.trigger_event ASC, a.name ASC`,
    [organizationId],
  );

  return result.rows;
}

async function getAutomationById(organizationId, automationId) {
  const result = await query(
    `SELECT ${AUTOMATION_COLUMNS} FROM email_automations
     WHERE id = $1 AND organization_id = $2
     LIMIT 1`,
    [automationId, organizationId],
  );

  return result.rows[0] || null;
}

// The template must belong to the same organisation: template_id arrives from the
// client, and the foreign key alone would happily accept another tenant's row.
async function assertTemplateInOrganization(organizationId, templateId) {
  const result = await query(
    "SELECT id FROM email_templates WHERE id = $1 AND organization_id = $2",
    [templateId, organizationId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Email template not found");
    error.statusCode = 404;
    throw error;
  }
}

async function createAutomation(organizationId, input) {
  const automation = normalizeAutomationInput(input);
  const errors = validateAutomationInput(automation);

  if (errors.length > 0) {
    const error = new Error("Invalid email automation");
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  await assertTemplateInOrganization(organizationId, automation.templateId);

  const result = await query(
    `INSERT INTO email_automations
       (organization_id, name, description, trigger_event, template_id,
        email_account_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${AUTOMATION_COLUMNS}`,
    [
      organizationId,
      automation.name,
      automation.description,
      automation.triggerEvent,
      automation.templateId,
      automation.emailAccountId,
      automation.isActive,
    ],
  );

  return result.rows[0];
}

async function updateAutomation(organizationId, automationId, input) {
  const existing = await getAutomationById(organizationId, automationId);

  if (!existing) {
    const error = new Error("Email automation not found");
    error.statusCode = 404;
    throw error;
  }

  const automation = normalizeAutomationInput({ ...existing, ...input });
  const errors = validateAutomationInput(automation);

  if (errors.length > 0) {
    const error = new Error("Invalid email automation");
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  await assertTemplateInOrganization(organizationId, automation.templateId);

  const result = await query(
    `UPDATE email_automations
     SET name = $1, description = $2, trigger_event = $3, template_id = $4,
         email_account_id = $5, is_active = $6, updated_at = NOW()
     WHERE id = $7 AND organization_id = $8
     RETURNING ${AUTOMATION_COLUMNS}`,
    [
      automation.name,
      automation.description,
      automation.triggerEvent,
      automation.templateId,
      automation.emailAccountId,
      automation.isActive,
      automationId,
      organizationId,
    ],
  );

  return result.rows[0];
}

async function setAutomationStatus(organizationId, automationId, isActive) {
  const result = await query(
    `UPDATE email_automations
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2 AND organization_id = $3
     RETURNING ${AUTOMATION_COLUMNS}`,
    [Boolean(isActive), automationId, organizationId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Email automation not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

async function deleteAutomation(organizationId, automationId) {
  const result = await query(
    "DELETE FROM email_automations WHERE id = $1 AND organization_id = $2 RETURNING id",
    [automationId, organizationId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Email automation not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

/*
 * =========================================================
 * EVENT QUEUE
 * =========================================================
 */

async function enqueueEvent(organizationId, input) {
  const event = input.event?.trim();

  if (!TRIGGER_EVENTS.includes(event)) {
    const error = new Error("Unknown automation event");
    error.statusCode = 400;
    error.details = [`event must be one of: ${TRIGGER_EVENTS.join(", ")}`];
    throw error;
  }

  if (!input.payload || typeof input.payload !== "object") {
    const error = new Error("Event payload is required");
    error.statusCode = 400;
    throw error;
  }

  // ON CONFLICT is what makes a producer-side retry safe: the same dedupe_key
  // returns the row already queued instead of sending a second email.
  const result = await query(
    `INSERT INTO automation_events (organization_id, event, payload, dedupe_key)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING ${EVENT_COLUMNS}`,
    [organizationId, event, JSON.stringify(input.payload), input.dedupe_key?.trim() || null],
  );

  if (result.rows.length > 0) {
    return { event: result.rows[0], duplicate: false };
  }

  // No row returned means ON CONFLICT suppressed the insert, which can only
  // happen when a dedupe_key was supplied and is already queued.
  const existing = await query(
    `SELECT ${EVENT_COLUMNS} FROM automation_events WHERE dedupe_key = $1`,
    [input.dedupe_key.trim()],
  );

  return { event: existing.rows[0] || null, duplicate: true };
}

/*
 * SKIP LOCKED so a second email-service replica can never claim the same event.
 * Without it, two runners polling simultaneously would both send.
 */
async function claimDueEvents(limit = 10) {
  const result = await query(
    `UPDATE automation_events
     SET status = 'processing', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM automation_events
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING ${EVENT_COLUMNS}`,
    [limit],
  );

  return result.rows;
}

async function findActiveAutomations(organizationId, event) {
  const result = await query(
    `SELECT a.id, a.name, a.trigger_event, a.template_id, a.email_account_id
     FROM email_automations a
     WHERE a.organization_id = $1
       AND a.trigger_event = $2
       AND a.is_active = true
     ORDER BY a.id ASC`,
    [organizationId, event],
  );

  return result.rows;
}

async function completeEvent(eventId) {
  await query(
    "UPDATE automation_events SET status = 'done', processed_at = NOW(), last_error = NULL WHERE id = $1",
    [eventId],
  );
}

// Exponential backoff, capped by MAX_ATTEMPTS. A failed event stays visible with
// its error rather than disappearing, which is the whole point of the queue.
async function failEvent(eventId, attempts, message) {
  const exhausted = attempts >= MAX_ATTEMPTS;

  await query(
    `UPDATE automation_events
     SET status = $1,
         last_error = $2,
         processed_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
         next_attempt_at = NOW() + make_interval(secs => $4)
     WHERE id = $5`,
    [
      exhausted ? "failed" : "pending",
      message ? String(message).slice(0, 2000) : null,
      exhausted,
      Math.min(2 ** attempts, 600) * 10,
      eventId,
    ],
  );
}

module.exports = {
  TRIGGER_EVENTS,
  MAX_ATTEMPTS,
  listAutomations,
  getAutomationById,
  createAutomation,
  updateAutomation,
  setAutomationStatus,
  deleteAutomation,
  enqueueEvent,
  claimDueEvents,
  findActiveAutomations,
  completeEvent,
  failEvent,
};
