const { query } = require("../config/database");

const TEMPLATE_COLUMNS = `
  id,
  organization_id,
  name,
  subject,
  body,
  description,
  is_active,
  created_by,
  created_at,
  updated_at
`;

function normalizeTemplateInput(input) {
  return {
    name: input.name?.trim(),
    subject: input.subject?.trim(),
    body: typeof input.body === "string" ? input.body : null,
    description: input.description?.trim() || null,
    isActive: input.is_active === undefined ? true : Boolean(input.is_active),
  };
}

function validateTemplateInput(input) {
  const errors = [];

  if (!input.name) {
    errors.push("name is required");
  }

  if (!input.subject) {
    errors.push("subject is required");
  }

  if (!input.body || !input.body.trim()) {
    errors.push("body is required");
  }

  return errors;
}

function invalid(errors) {
  const error = new Error("Invalid email template");
  error.statusCode = 400;
  error.details = errors;
  return error;
}

/*
 * Substitutes {{lead.name}}, {{customer.company}}, {{organization.name}} and the
 * like from the event payload.
 *
 * An unresolved placeholder is left exactly as written rather than replaced with
 * an empty string or "undefined": a visible {{lead.company}} in a test send is a
 * bug report, whereas a silent blank reaches the customer unnoticed.
 */
function renderTemplate(text, context) {
  if (!text) {
    return "";
  }

  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path) => {
    const value = path
      .split(".")
      .reduce((node, key) => (node == null ? undefined : node[key]), context);

    return value === undefined || value === null || value === "" ? match : String(value);
  });
}

async function listTemplates(organizationId) {
  const result = await query(
    `SELECT ${TEMPLATE_COLUMNS} FROM email_templates
     WHERE organization_id = $1
     ORDER BY name ASC`,
    [organizationId],
  );

  return result.rows;
}

async function getTemplateById(organizationId, templateId) {
  const result = await query(
    `SELECT ${TEMPLATE_COLUMNS} FROM email_templates
     WHERE id = $1 AND organization_id = $2
     LIMIT 1`,
    [templateId, organizationId],
  );

  return result.rows[0] || null;
}

async function createTemplate(organizationId, userId, input) {
  const template = normalizeTemplateInput(input);
  const errors = validateTemplateInput(template);

  if (errors.length > 0) {
    throw invalid(errors);
  }

  const result = await query(
    `INSERT INTO email_templates
       (organization_id, name, subject, body, description, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${TEMPLATE_COLUMNS}`,
    [
      organizationId,
      template.name,
      template.subject,
      template.body,
      template.description,
      template.isActive,
      userId || null,
    ],
  );

  return result.rows[0];
}

async function updateTemplate(organizationId, templateId, input) {
  const existing = await getTemplateById(organizationId, templateId);

  if (!existing) {
    const error = new Error("Email template not found");
    error.statusCode = 404;
    throw error;
  }

  // Spread the stored row first so an omitted field keeps its current value.
  const template = normalizeTemplateInput({ ...existing, ...input });
  const errors = validateTemplateInput(template);

  if (errors.length > 0) {
    throw invalid(errors);
  }

  const result = await query(
    `UPDATE email_templates
     SET name = $1, subject = $2, body = $3, description = $4, is_active = $5,
         updated_at = NOW()
     WHERE id = $6 AND organization_id = $7
     RETURNING ${TEMPLATE_COLUMNS}`,
    [
      template.name,
      template.subject,
      template.body,
      template.description,
      template.isActive,
      templateId,
      organizationId,
    ],
  );

  return result.rows[0];
}

async function deleteTemplate(organizationId, templateId) {
  const result = await query(
    "DELETE FROM email_templates WHERE id = $1 AND organization_id = $2 RETURNING id",
    [templateId, organizationId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Email template not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

module.exports = {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderTemplate,
};
