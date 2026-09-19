const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/emailTemplateController");

const router = express.Router();

router.get("/", authenticate, requirePermission("email.templates.read"), controller.getTemplates);

router.get("/:id", authenticate, requirePermission("email.templates.read"), controller.getTemplate);

router.post("/", authenticate, requirePermission("email.templates.create"), controller.createTemplate);

router.put("/:id", authenticate, requirePermission("email.templates.update"), controller.updateTemplate);

router.delete("/:id", authenticate, requirePermission("email.templates.delete"), controller.deleteTemplate);

module.exports = router;
