const express = require("express");
const emailController = require("../controllers/emailController");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");

const router = express.Router();

router.post(
  "/send",
  authenticate,
  requirePermission("email.send"),
  emailController.sendEmail,
);

router.post(
  "/conversations/:conversationId/reply",
  authenticate,
  requirePermission("email.send"),
  emailController.replyToConversation,
);

router.get(
  "/communications",
  authenticate,
  requirePermission("communications.read"),
  emailController.getCommunications,
);

router.get(
  "/communications/:id",
  authenticate,
  requirePermission("communications.read"),
  emailController.getCommunication,
);

module.exports = router;
