const emailAutomationService = require("../services/emailAutomationService");

function getOrganizationId(req) {
  const organizationId = Number(req.auth?.organizationId);

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    const error = new Error("Authenticated organization is required");
    error.statusCode = 401;
    throw error;
  }

  return organizationId;
}

function getAutomationId(req) {
  const automationId = Number(req.params.id);

  if (!Number.isInteger(automationId) || automationId <= 0) {
    const error = new Error("Invalid email automation ID");
    error.statusCode = 400;
    throw error;
  }

  return automationId;
}

function handleError(res, error) {
  console.error("[Email Automation Controller]", error);

  if (error.code === "23505") {
    return res.status(409).json({ error: "An automation with this name already exists" });
  }

  return res.status(error.statusCode || 500).json({
    error: error.message || "Internal server error",
    ...(error.details ? { details: error.details } : {}),
  });
}

async function getAutomations(req, res) {
  try {
    const automations = await emailAutomationService.listAutomations(getOrganizationId(req));

    return res.json({
      automations,
      count: automations.length,
      events: emailAutomationService.TRIGGER_EVENTS,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getAutomation(req, res) {
  try {
    const automation = await emailAutomationService.getAutomationById(
      getOrganizationId(req),
      getAutomationId(req),
    );

    if (!automation) {
      return res.status(404).json({ error: "Email automation not found" });
    }

    return res.json({ automation });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createAutomation(req, res) {
  try {
    const automation = await emailAutomationService.createAutomation(
      getOrganizationId(req),
      req.body || {},
    );

    return res.status(201).json({ automation });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateAutomation(req, res) {
  try {
    const automation = await emailAutomationService.updateAutomation(
      getOrganizationId(req),
      getAutomationId(req),
      req.body || {},
    );

    return res.json({ automation });
  } catch (error) {
    return handleError(res, error);
  }
}

async function activateAutomation(req, res) {
  try {
    const automation = await emailAutomationService.setAutomationStatus(
      getOrganizationId(req),
      getAutomationId(req),
      true,
    );

    return res.json({ automation });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deactivateAutomation(req, res) {
  try {
    const automation = await emailAutomationService.setAutomationStatus(
      getOrganizationId(req),
      getAutomationId(req),
      false,
    );

    return res.json({ automation });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteAutomation(req, res) {
  try {
    await emailAutomationService.deleteAutomation(getOrganizationId(req), getAutomationId(req));

    return res.status(204).send();
  } catch (error) {
    return handleError(res, error);
  }
}

/*
 * Called service-to-service by lead-service and customer-service, forwarding the
 * acting user's token. It queues and returns 202 without sending: that keeps a
 * slow SMTP server out of the lead-creation path, and means delivery is retried
 * from the queue rather than depending on this request succeeding.
 */
async function triggerEvent(req, res) {
  try {
    const { event, duplicate } = await emailAutomationService.enqueueEvent(
      getOrganizationId(req),
      req.body || {},
    );

    return res.status(202).json({
      message: duplicate ? "Event already queued" : "Event queued",
      duplicate,
      event,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  getAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  activateAutomation,
  deactivateAutomation,
  deleteAutomation,
  triggerEvent,
};
