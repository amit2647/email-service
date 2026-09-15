const emailService = require("../services/emailService");

async function sendEmail(req, res) {
  try {
    const { to, subject, html, text, replyTo } = req.body;

    const result = await emailService.sendEmail({
      to,
      subject,
      html,
      text,
      replyTo,
    });

    return res.status(202).json({
      message: "Email accepted for delivery",
      ...result,
    });
  } catch (error) {
    console.error("[SMTP ERROR]", error);

    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to send email",
    });
  }
}

module.exports = {
  sendEmail,
};
