const emailTemplateService = require("../services/emailTemplateService");

function getOrganizationId(req) {
  const organizationId = Number(req.auth?.organizationId);

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    const error = new Error("Authenticated organization is required");
    error.statusCode = 401;
    throw error;
  }

  return organizationId;
}

function getTemplateId(req) {
  const templateId = Number(req.params.id);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    const error = new Error("Invalid email template ID");
    error.statusCode = 400;
    throw error;
  }

  return templateId;
}

function handleError(res, error) {
  console.error("[Email Template Controller]", error);

  // 23503 is a foreign key violation, which here means an automation still
  // points at the template. Deleting it would break that automation, so the
  // schema uses ON DELETE RESTRICT and this reports it as a conflict.
  if (error.code === "23503") {
    return res.status(409).json({
      error: "This template is used by an automation. Delete the automation first.",
    });
  }

  if (error.code === "23505") {
    return res.status(409).json({ error: "A template with this name already exists" });
  }

  return res.status(error.statusCode || 500).json({
    error: error.message || "Internal server error",
    ...(error.details ? { details: error.details } : {}),
  });
}

async function getTemplates(req, res) {
  try {
    const templates = await emailTemplateService.listTemplates(getOrganizationId(req));

    return res.json({ templates, count: templates.length });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getTemplate(req, res) {
  try {
    const template = await emailTemplateService.getTemplateById(
      getOrganizationId(req),
      getTemplateId(req),
    );

    if (!template) {
      return res.status(404).json({ error: "Email template not found" });
    }

    return res.json({ template });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createTemplate(req, res) {
  try {
    const template = await emailTemplateService.createTemplate(
      getOrganizationId(req),
      req.auth?.userId,
      req.body || {},
    );

    return res.status(201).json({ template });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateTemplate(req, res) {
  try {
    const template = await emailTemplateService.updateTemplate(
      getOrganizationId(req),
      getTemplateId(req),
      req.body || {},
    );

    return res.json({ template });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteTemplate(req, res) {
  try {
    await emailTemplateService.deleteTemplate(getOrganizationId(req), getTemplateId(req));

    return res.status(204).send();
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
