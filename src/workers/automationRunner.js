const emailAutomationService = require("../services/emailAutomationService");
const emailTemplateService = require("../services/emailTemplateService");
const emailService = require("../services/emailService");
const { query } = require("../config/database");

const POLL_INTERVAL_MS = Number(process.env.AUTOMATION_POLL_INTERVAL_MS || 10000);
const BATCH_SIZE = Number(process.env.AUTOMATION_BATCH_SIZE || 10);

let timer = null;
let running = false;

/*
 * The payload carries the record itself, so rendering needs no callback to the
 * producing service. lead.* events put it under `lead`, customer.* under
 * `customer`; both are exposed so a template can use either name.
 */
function buildContext(payload) {
  return {
    lead: payload.lead || null,
    customer: payload.customer || null,
    organization: payload.organization || null,
    contact: payload.lead || payload.customer || null,
  };
}

function recipientOf(payload) {
  return payload.lead?.email || payload.customer?.email || payload.to || null;
}

/*
 * Filled here rather than by every producer: the runner already knows the
 * organization from the event row, and {{organization.name}} is wanted by most
 * templates.
 */
async function organizationOf(organizationId) {
  const result = await query("SELECT id, name FROM organizations WHERE id = $1", [
    organizationId,
  ]);

  return result.rows[0] || null;
}

async function runAutomation(event, automation) {
  const template = await emailTemplateService.getTemplateById(
    event.organization_id,
    automation.template_id,
  );

  if (!template) {
    throw new Error(`Template ${automation.template_id} not found`);
  }

  if (!template.is_active) {
    console.log(
      `[Automation] Skipping "${automation.name}": template "${template.name}" is inactive`,
    );
    return;
  }

  const payload = event.payload || {};
  const to = recipientOf(payload);

  if (!to) {
    throw new Error("Event payload has no recipient email address");
  }

  const context = buildContext({
    ...payload,
    organization: payload.organization || (await organizationOf(event.organization_id)),
  });

  await emailService.sendEmail({
    organizationId: event.organization_id,
    userId: payload.userId || null,
    // Same rule as the composer: without this the conversation is never linked
    // to the record and any reply arrives orphaned.
    leadId: payload.lead?.id || null,
    customerId: payload.customer?.id || null,
    emailAccountId: automation.email_account_id || null,
    to,
    subject: emailTemplateService.renderTemplate(template.subject, context),
    text: emailTemplateService.renderTemplate(template.body, context),
    // No user token in a background worker; ownership is checked locally.
    trusted: true,
  });

  console.log(`[Automation] Sent "${automation.name}" to ${to} for ${event.event}`);
}

async function processEvent(event) {
  const automations = await emailAutomationService.findActiveAutomations(
    event.organization_id,
    event.event,
  );

  if (automations.length === 0) {
    // Not a failure: an event with no enabled automation is the normal state
    // until someone turns one on.
    await emailAutomationService.completeEvent(event.id);
    return;
  }

  const failures = [];

  for (const automation of automations) {
    try {
      await runAutomation(event, automation);
    } catch (error) {
      console.error(`[Automation] "${automation.name}" failed:`, error.message);
      failures.push(`${automation.name}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    // Retried as a unit. Automations for one event are expected to be few, and
    // a per-automation cursor would be more state than this earns.
    await emailAutomationService.failEvent(event.id, event.attempts, failures.join("; "));
    return;
  }

  await emailAutomationService.completeEvent(event.id);
}

async function tick() {
  if (running) {
    return;
  }

  running = true;

  try {
    const events = await emailAutomationService.claimDueEvents(BATCH_SIZE);

    for (const event of events) {
      try {
        await processEvent(event);
      } catch (error) {
        console.error(`[Automation] Event ${event.id} errored:`, error.message);

        await emailAutomationService.failEvent(event.id, event.attempts, error.message);
      }
    }
  } catch (error) {
    // Never let a polling error kill the interval — the next tick retries.
    console.error("[Automation] Poll failed:", error.message);
  } finally {
    running = false;
  }
}

function startAutomationRunner() {
  if (timer) {
    return timer;
  }

  timer = setInterval(tick, POLL_INTERVAL_MS);

  console.log(`[Automation] Runner started, polling every ${POLL_INTERVAL_MS}ms`);

  return timer;
}

function stopAutomationRunner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startAutomationRunner,
  stopAutomationRunner,
  tick,
};
