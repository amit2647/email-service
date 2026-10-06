const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

/*
 * The trigger route's service token: accepted only when signed with
 * SERVICE_JWT_SECRET for the trigger scope, and only there.
 */

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "unit-test-issuer";
process.env.SERVICE_JWT_SECRET = "unit-test-service-secret";

const { pool } = require("../src/config/database");

let queued;

pool.query = async (text, params) => {
  if (/access_grants/.test(text)) return { rows: [] };
  if (/INSERT INTO automation_events/.test(text)) {
    queued.push(params);
    return { rows: [{ id: 1, event: params[1] }], rowCount: 1 };
  }
  return { rows: [] };
};

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

const service = (claims = {}, secret = process.env.SERVICE_JWT_SECRET, issuer = "omnicore-services") =>
  jwt.sign({ service: "obligation-service", organizationId: 3, scope: "automations.trigger", ...claims }, secret, { issuer, expiresIn: "5m" });

const call = (path, token, body = { event: "obligation.due_soon", dedupe_key: "obligation:1:due_soon", payload: { client: { email: "a@b.example" } } }) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

test("a service token queues a deadline reminder for its own organization", async () => {
  queued = [];
  const response = await call("/emails/automations/trigger", service());

  assert.equal(response.status, 202);
  assert.equal(queued[0][0], 3);
});

test("a service token signed with the users' secret is refused", async () => {
  assert.equal((await call("/emails/automations/trigger", service({}, process.env.JWT_SECRET))).status, 401);
});

test("a service token without the trigger scope is refused", async () => {
  assert.equal((await call("/emails/automations/trigger", service({ scope: "everything" }))).status, 401);
});

test("a service token opens no other route", async () => {
  assert.equal((await call("/emails/send", service(), { to: "x@y.example", subject: "s", body: "b" })).status, 401);
});
