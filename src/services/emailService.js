const { transporter } = require("../config/smtp");

async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to) {
    const error = new Error("Recipient email is required");
    error.statusCode = 400;
    throw error;
  }

  if (!subject) {
    const error = new Error("Email subject is required");
    error.statusCode = 400;
    throw error;
  }

  if (!html && !text) {
    const error = new Error("Email content is required");
    error.statusCode = 400;
    throw error;
  }

  const mail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,

    to,

    subject,

    html,

    text,

    ...(replyTo ? { replyTo } : {}),
  };

  console.log(`[SMTP] Sending email to ${to}`);

  const result = await transporter.sendMail(mail);

  console.log(`[SMTP] Email sent successfully: ${result.messageId}`);

  return {
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
  };
}

module.exports = {
  sendEmail,
};
