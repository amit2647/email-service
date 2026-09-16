const emailService = require("../services/emailService");

function getAuthorizationToken(req) {
  const authorization = req.headers.authorization;

  return authorization?.startsWith("Bearer ")
    ? authorization.substring(7)
    : null;
}

async function sendEmail(req, res) {
  try {
    const { to, subject, html, text, replyTo, leadId, customerId } = req.body;

    const result = await emailService.sendEmail({
      organizationId: req.auth.organizationId,
      userId: req.auth.userId,
      leadId,
      customerId,
      to,
      subject,
      html,
      text,
      replyTo,
      authorizationToken: getAuthorizationToken(req),
    });

    return res.status(202).json({
      message: "Email accepted for delivery",
      ...result,
    });
  } catch (error) {
    console.error("[Email Controller]", error);

    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to send email",
    });
  }
}

async function replyToConversation(req, res) {
  try {
    const conversationId = Number(req.params.conversationId);

    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({
        error: "Invalid conversation ID",
      });
    }

    const { to, subject, html, text, replyTo } = req.body;

    const result = await emailService.replyToConversation({
      organizationId: req.auth.organizationId,
      userId: req.auth.userId,
      conversationId,
      to,
      subject,
      html,
      text,
      replyTo,
      authorizationToken: getAuthorizationToken(req),
    });

    return res.status(202).json({
      message: "Email reply accepted for delivery",
      ...result,
    });
  } catch (error) {
    console.error("[Email Controller]", error);

    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to send email reply",
    });
  }
}

async function getCommunication(req, res) {
  try {
    const communicationId = Number(req.params.id);

    if (!Number.isInteger(communicationId) || communicationId <= 0) {
      return res.status(400).json({
        error: "Invalid communication ID",
      });
    }

    const communication = await emailService.getCommunicationById({
      organizationId: req.auth.organizationId,
      communicationId,
    });

    return res.json(communication);
  } catch (error) {
    console.error("[Email Controller]", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to retrieve communication",
    });
  }
}

async function getCommunications(req, res) {
  try {
    const leadId = req.query.leadId ? Number(req.query.leadId) : undefined;

    const customerId = req.query.customerId
      ? Number(req.query.customerId)
      : undefined;

    const conversationId = req.query.conversationId
      ? Number(req.query.conversationId)
      : undefined;

    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    if (leadId !== undefined && (!Number.isInteger(leadId) || leadId <= 0)) {
      return res.status(400).json({
        error: "Invalid leadId",
      });
    }

    if (
      customerId !== undefined &&
      (!Number.isInteger(customerId) || customerId <= 0)
    ) {
      return res.status(400).json({
        error: "Invalid customerId",
      });
    }

    if (
      conversationId !== undefined &&
      (!Number.isInteger(conversationId) || conversationId <= 0)
    ) {
      return res.status(400).json({
        error: "Invalid conversationId",
      });
    }

    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return res.status(400).json({
        error: "Invalid limit",
      });
    }

    const communications = await emailService.getCommunications({
      organizationId: req.auth.organizationId,
      leadId,
      customerId,
      conversationId,
      limit,
    });

    return res.json({
      communications,
      count: communications.length,
    });
  } catch (error) {
    console.error("[Email Controller]", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to retrieve communications",
    });
  }
}

module.exports = {
  sendEmail,
  replyToConversation,
  getCommunication,
  getCommunications,
};
