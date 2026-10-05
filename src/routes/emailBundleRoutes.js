const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const { installEmail } = require("../services/bundleInstallService");

const router = express.Router();

const KEY = /^[a-z][a-z0-9-]{1,59}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/*
 * The email step of a profession bundle install: templates plus their
 * automations, always switched off. Called by bundle-service with the
 * installing admin's token.
 */
router.put("/:key/:version", authenticate, requirePermission("bundles.manage"), async (req, res) => {
  try {
    const { key, version } = req.params;

    if (!KEY.test(key) || !VERSION.test(version)) {
      return res.status(400).json({ error: "Invalid bundle key or version" });
    }

    const items = req.body && req.body.email;

    if (!Array.isArray(items) || items.some((item) => !item.key || !item.name || !item.trigger || !item.subject || !item.body)) {
      return res.status(400).json({ error: "email must be a list of { key, name, trigger, subject, body }" });
    }

    return res.json(await installEmail(req.auth.organizationId, req.auth.userId, key, version, items));
  } catch (error) {
    console.error("[Bundle Install] email:", error.message);

    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Email install failed",
    });
  }
});

module.exports = router;
