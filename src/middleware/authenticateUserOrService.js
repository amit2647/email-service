const jwt = require("jsonwebtoken");

const authenticate = require("./authenticate");

/*
 * For POST /emails/automations/trigger only: accepts a person's token as
 * usual, or a service token from a background worker that has no person
 * behind it (obligation-service's deadline reminders).
 *
 * A service token is signed with SERVICE_JWT_SECRET — never JWT_SECRET —
 * carries issuer "omnicore-services", scope "automations.trigger" and one
 * organizationId, and grants nothing else: no permissions, no user. Without
 * SERVICE_JWT_SECRET no service token is accepted.
 */
function authenticateUserOrService(req, res, next) {
  const secret = process.env.SERVICE_JWT_SECRET;
  const [scheme, token] = String(req.headers.authorization || "").split(" ");

  if (secret && scheme === "Bearer" && token) {
    try {
      const claims = jwt.verify(token, secret, { issuer: "omnicore-services" });
      const organizationId = Number(claims.organizationId);

      if (claims.scope === "automations.trigger" && Number.isInteger(organizationId) && organizationId > 0) {
        req.auth = { userId: null, organizationId, role: null, permissions: [], service: claims.service || "service" };
        return next();
      }
    } catch {
      // Not a service token; try it as a person's.
    }
  }

  return authenticate(req, res, next);
}

module.exports = authenticateUserOrService;
