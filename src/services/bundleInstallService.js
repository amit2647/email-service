const { pool } = require("../config/database");
const { customized, decide, optionsFor } = require("./bundleSync");

/*
 * The email step of a bundle install: each item ships a template and the
 * automation that sends it, matched by their stable `key`.
 *
 * Automations are always installed switched OFF and an install never turns
 * one on — they send real mail, so a firm opts in from Settings. bundleSync's
 * rule applies to both: a template whose wording the firm changed is kept.
 */

// A dry run does all the work and rolls it back, to report what it would do.
async function inTransaction(work, { dryRun = false } = {}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      const conflict = new Error("An email template or automation with this name already belongs to something else");
      conflict.statusCode = 409;
      throw conflict;
    }

    throw error;
  } finally {
    client.release();
  }
}

async function findRow(client, table, organizationId, key, name) {
  const found = await client.query(
    `SELECT * FROM ${table}
     WHERE organization_id = $1 AND (key = $2 OR (key IS NULL AND name = $3))
     ORDER BY key NULLS LAST
     LIMIT 1`,
    [organizationId, key, name],
  );

  return found.rows[0] || null;
}

async function track(client, table, row, { key, bundleKey, version, action, shippedChecksum, flag, acknowledge }) {
  if (action === "keep") {
    // Dismissed: the firm keeps theirs and has seen this version (bundleSync).
    await client.query(
      `UPDATE ${table}
       SET key = $1, bundle_key = $2, retired_at = NULL,
           update_available_version = CASE WHEN $6 THEN NULL WHEN $3 THEN $4 ELSE update_available_version END,
           source_checksum = CASE WHEN $6 THEN $7 ELSE source_checksum END
       WHERE id = $5`,
      [key, bundleKey, flag, version, row.id, Boolean(acknowledge), shippedChecksum],
    );
    return;
  }

  await client.query(
    `UPDATE ${table}
     SET key = $1, bundle_key = $2, source_version = $3, source_checksum = $4,
         update_available_version = NULL, retired_at = NULL
     WHERE id = $5`,
    [key, bundleKey, version, shippedChecksum, row.id],
  );
}

async function installEmail(organizationId, userId, bundleKey, version, items = [], choices = {}) {
  return inTransaction(async (client) => {
    const summary = { inserted: 0, updated: 0, unchanged: 0, kept: 0, retired: 0, customized: [] };
    const count = (action) => {
      summary[{ insert: "inserted", update: "updated", unchanged: "unchanged", keep: "kept" }[action]] += 1;
    };

    for (const item of items) {
      // Template
      const template = { name: item.name, subject: item.subject, body: item.body };
      const templateRow = await findRow(client, "email_templates", organizationId, item.key, template.name);
      const templateMine = templateRow && { name: templateRow.name, subject: templateRow.subject, body: templateRow.body };
      const templateDecision = decide(
        templateRow && { content: templateMine, sourceChecksum: templateRow.source_checksum },
        template,
        optionsFor(choices, "template", item.key),
      );
      if (templateDecision.action === "keep" && templateDecision.flag) {
        summary.customized.push(customized("template", item.key, templateRow.name, templateMine, template, version));
      }

      let templateId;

      if (templateDecision.action === "insert") {
        const created = await client.query(
          `INSERT INTO email_templates (organization_id, name, subject, body, description, created_by,
                                        key, bundle_key, source_version, source_checksum)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [organizationId, template.name, template.subject, template.body, "Installed by a profession bundle", userId,
            item.key, bundleKey, version, templateDecision.shippedChecksum],
        );
        templateId = created.rows[0].id;
      } else {
        templateId = templateRow.id;

        if (templateDecision.action === "update") {
          await client.query(
            "UPDATE email_templates SET name = $1, subject = $2, body = $3, updated_at = NOW() WHERE id = $4",
            [template.name, template.subject, template.body, templateId],
          );
        }

        await track(client, "email_templates", templateRow, { key: item.key, bundleKey, version, ...templateDecision });
      }

      count(templateDecision.action);

      // Automation — compared on what it does, never on whether it is on.
      const automation = { name: item.name, trigger_event: item.trigger, template_key: item.key };
      const automationRow = await findRow(client, "email_automations", organizationId, item.key, automation.name);
      const automationMine = automationRow && {
        name: automationRow.name,
        trigger_event: automationRow.trigger_event,
        template_key: automationRow.template_id === templateId ? item.key : `template:${automationRow.template_id}`,
      };
      // Accepting never switches an automation on: only what it does is compared or taken.
      const automationDecision = decide(
        automationRow && { content: automationMine, sourceChecksum: automationRow.source_checksum },
        automation,
        optionsFor(choices, "automation", item.key),
      );
      if (automationDecision.action === "keep" && automationDecision.flag) {
        summary.customized.push(customized("automation", item.key, automationRow.name, automationMine, automation, version));
      }

      if (automationDecision.action === "insert") {
        await client.query(
          `INSERT INTO email_automations (organization_id, name, description, trigger_event, template_id,
                                          is_active, key, bundle_key, source_version, source_checksum)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9)`,
          [organizationId, automation.name, "Installed by a profession bundle — switched off until you turn it on",
            automation.trigger_event, templateId, item.key, bundleKey, version, automationDecision.shippedChecksum],
        );
      } else {
        if (automationDecision.action === "update") {
          await client.query(
            "UPDATE email_automations SET name = $1, trigger_event = $2, template_id = $3, updated_at = NOW() WHERE id = $4",
            [automation.name, automation.trigger_event, templateId, automationRow.id],
          );
        }

        await track(client, "email_automations", automationRow, { key: item.key, bundleKey, version, ...automationDecision });
      }

      count(automationDecision.action);
    }

    // Dropped items: the automation is switched off as well as retired, so a
    // reminder the bundle withdrew cannot keep sending.
    const keys = items.map((item) => item.key);
    const automations = await client.query(
      `UPDATE email_automations SET retired_at = NOW(), is_active = false
       WHERE organization_id = $1 AND bundle_key = $2 AND retired_at IS NULL AND key <> ALL($3::text[])`,
      [organizationId, bundleKey, keys],
    );
    const templates = await client.query(
      `UPDATE email_templates SET retired_at = NOW()
       WHERE organization_id = $1 AND bundle_key = $2 AND retired_at IS NULL AND key <> ALL($3::text[])`,
      [organizationId, bundleKey, keys],
    );

    summary.retired = automations.rowCount + templates.rowCount;

    return summary;
  }, choices);
}

module.exports = { installEmail };
