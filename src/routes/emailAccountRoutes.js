const express = require("express");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/emailAccountController");

const router = express.Router();

router.post(
  "/",
  authenticate,
  requirePermission("system.integrations"),
  controller.createAccount,
);

router.get(
  "/",
  authenticate,
  requirePermission("system.integrations"),
  controller.getAccounts,
);

router.get(
  "/:id",
  authenticate,
  requirePermission("system.integrations"),
  controller.getAccount,
);

router.put(
  "/:id",
  authenticate,
  requirePermission("system.integrations"),
  controller.updateAccount,
);

router.post(
  "/:id/activate",
  authenticate,
  requirePermission("system.integrations"),
  controller.activateAccount,
);

router.post(
  "/:id/deactivate",
  authenticate,
  requirePermission("system.integrations"),
  controller.deactivateAccount,
);

router.delete(
  "/:id",
  authenticate,
  requirePermission("system.integrations"),
  controller.deleteAccount,
);

module.exports = router;
