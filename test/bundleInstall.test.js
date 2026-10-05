const { describe, test, beforeEach, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

/*
 * The email step of a bundle install. What matters most: automations arrive
 * switched off and an install never turns one on, because they send real mail.
 */

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "unit-test-issuer";

const { pool } = require("../src/config/database");
const { checksum } = require("../src/services/bundleSync");

let statements;
let rows;
let bundleInstalled;

function fakeClient() {
  return {
    async query(text, params = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      statements.push({ sql, params });

      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {};

      const select = /^SELECT \* FROM (email_templates|email_automations) WHERE/.exec(sql);
      if (select) {
        const [, key, name] = params;
        const row = rows[select[1]].find((item) => item.key === key || (item.key == null && item.name === name));
        return { rows: row ? [row] : [] };
      }

      if (/^INSERT INTO email_templates/.test(sql)) return { rows: [{ id: 40 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
}

pool.connect = async () => fakeClient();
pool.query = async (text) => {
  if (/access_grants/.test(text)) return { rows: [] };
  if (/FROM organization_bundles/.test(text)) return { rows: bundleInstalled ? [{ "?column?": 1 }] : [] };
  if (/FROM email_templates WHERE id/.test(text)) return { rows: [{ id: 1 }] };
  return { rows: [] };
};

const { installEmail } = require("../src/services/bundleInstallService");

const ITEM = {
  key: "obligation_due_soon",
  name: "Deadline due soon",
  trigger: "obligation.due_soon",
  subject: "{{obligation.title}} is due",
  body: "Hello {{client.name}}",
};

beforeEach(() => {
  statements = [];
  rows = { email_templates: [], email_automations: [] };
  bundleInstalled = false;
});

const find = (pattern) => statements.filter((statement) => pattern.test(statement.sql));

describe("installEmail", () => {
  test("installs the template and its automation, switched off", async () => {
    const summary = await installEmail(3, 1, "ca-practice", "0.1.0", [ITEM]);

    assert.equal(summary.inserted, 2);

    const automation = find(/^INSERT INTO email_automations/)[0];

    assert.match(automation.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, false,/);
    assert.equal(automation.params[3], "obligation.due_soon");
    assert.equal(automation.params[4], 40);
  });

  test("never switches an existing automation on or off when reinstalling", async () => {
    const template = { name: ITEM.name, subject: ITEM.subject, body: ITEM.body };
    const automation = { name: ITEM.name, trigger_event: ITEM.trigger, template_key: ITEM.key };

    rows.email_templates.push({ id: 40, key: ITEM.key, ...template, source_checksum: checksum(template) });
    rows.email_automations.push({ id: 9, key: ITEM.key, name: ITEM.name, trigger_event: ITEM.trigger, template_id: 40, is_active: true, source_checksum: checksum(automation) });

    const summary = await installEmail(3, 1, "ca-practice", "0.1.0", [ITEM]);

    assert.equal(summary.unchanged, 2);
    assert.equal(statements.some((statement) => /is_active/.test(statement.sql) && !/retired_at = NOW/.test(statement.sql)), false);
  });

  test("keeps a template whose wording the firm changed", async () => {
    const shipped = { name: ITEM.name, subject: ITEM.subject, body: ITEM.body };

    rows.email_templates.push({ id: 40, key: ITEM.key, name: ITEM.name, subject: ITEM.subject, body: "Our own words", source_checksum: checksum(shipped) });

    const summary = await installEmail(3, 1, "ca-practice", "0.1.0", [ITEM]);

    assert.equal(summary.kept, 1);
    assert.equal(find(/^UPDATE email_templates SET name/).length, 0);
  });

  test("a withdrawn reminder is retired and switched off", async () => {
    await installEmail(3, 1, "ca-practice", "0.2.0", []);

    const retire = find(/^UPDATE email_automations SET retired_at = NOW\(\), is_active = false/)[0];

    assert.deepEqual(retire.params, [3, "ca-practice", []]);
  });
});

describe("routes", () => {
  const app = require("../src/app");
  let server;
  let base;

  before(async () => {
    mock.method(console, "log", () => {});
    mock.method(console, "error", () => {});
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  const call = (method, path, permissions, body) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt.sign({ sub: 1, organizationId: 3, role: "X", permissions }, process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER })}`,
      },
      body: JSON.stringify(body),
    });

  test("the install step needs bundles.manage", async () => {
    assert.equal((await call("PUT", "/emails/bundles/ca-practice/0.1.0", ["email.templates.create"], { email: [ITEM] })).status, 403);
  });

  test("the install step refuses an incomplete item", async () => {
    assert.equal((await call("PUT", "/emails/bundles/ca-practice/0.1.0", ["bundles.manage"], { email: [{ key: "x" }] })).status, 400);
  });

  test("a deadline event is refused for an organization without a bundle", async () => {
    const response = await call("POST", "/emails/automations", ["email.automations.create"], {
      name: "Reminder",
      trigger_event: "obligation.due_soon",
      template_id: 1,
    });

    assert.equal(response.status, 400);
  });
});
