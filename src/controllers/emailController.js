const emailService = require("../services/emailService");

async function sendEmail(req, res) {
  try {
    const { to, subject, html, text, replyTo, leadId, customerId } = req.body;

    const authorization = req.headers.authorization;

    const token = authorization?.startsWith("Bearer ")
      ? authorization.substring(7)
      : null;

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

      authorizationToken: token,
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

    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return res.status(400).json({
        error: "Invalid limit",
      });
    }

    const communications = await emailService.getCommunications({
      organizationId: req.auth.organizationId,
      leadId,
      customerId,
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
  getCommunication,
  getCommunications,
};
