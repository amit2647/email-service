const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/emailAutomationController");

const router = express.Router();

/*
 * No email.automations.* permission on the trigger: the caller is whoever just
 * created the lead or customer, and requiring an automation permission would
 * mean a SALES_REP could not create a lead without also being able to edit
 * automations. Authentication still scopes it to their organization.
 *
 * Declared before /:id so "trigger" is never read as an id.
 */
router.post("/trigger", authenticate, controller.triggerEvent);

router.get("/", authenticate, requirePermission("email.automations.read"), controller.getAutomations);

router.get("/:id", authenticate, requirePermission("email.automations.read"), controller.getAutomation);

router.post("/", authenticate, requirePermission("email.automations.create"), controller.createAutomation);

router.put("/:id", authenticate, requirePermission("email.automations.update"), controller.updateAutomation);

router.post(
  "/:id/activate",
  authenticate,
  requirePermission("email.automations.update"),
  controller.activateAutomation,
);

router.post(
  "/:id/deactivate",
  authenticate,
  requirePermission("email.automations.update"),
  controller.deactivateAutomation,
);

router.delete("/:id", authenticate, requirePermission("email.automations.delete"), controller.deleteAutomation);

module.exports = router;
