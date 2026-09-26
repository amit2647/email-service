const { test } = require("node:test");
const assert = require("node:assert/strict");

const { renderTemplate } = require("../src/services/emailTemplateService");

/*
 * Placeholders in automation emails. An unresolved one must stay visible as
 * written: a blank or "undefined" would reach a real customer unnoticed.
 */

const context = {
  lead: { name: "Priya Nair", company: "Kestrel Analytics" },
  organization: { name: "Acme Corporation" },
};

test("fills placeholders from the event payload", () => {
  assert.equal(
    renderTemplate("Hi {{lead.name}} from {{organization.name}}", context),
    "Hi Priya Nair from Acme Corporation",
  );
});

test("tolerates spaces inside the braces", () => {
  assert.equal(renderTemplate("{{ lead.company }}", context), "Kestrel Analytics");
});

test("leaves an unknown placeholder exactly as written", () => {
  assert.equal(renderTemplate("Dear {{customer.name}}", context), "Dear {{customer.name}}");
});

test("leaves a placeholder whose value is empty or null as written", () => {
  const sparse = { lead: { name: "", company: null } };

  assert.equal(
    renderTemplate("{{lead.name}}/{{lead.company}}", sparse),
    "{{lead.name}}/{{lead.company}}",
  );
});

test("never prints undefined when a path runs off the end", () => {
  assert.equal(renderTemplate("{{lead.owner.name}}", context), "{{lead.owner.name}}");
});

test("returns an empty string for empty input", () => {
  assert.equal(renderTemplate("", context), "");
  assert.equal(renderTemplate(null, context), "");
});

test("renders numbers as text", () => {
  assert.equal(renderTemplate("Score {{lead.score}}", { lead: { score: 0 } }), "Score 0");
});
