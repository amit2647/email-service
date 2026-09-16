const nodemailer = require("nodemailer");

function createSmtpTransporter(emailAccount = {}) {
  const host =
    emailAccount.smtp_host || process.env.SMTP_HOST || "smtp.gmail.com";

  const port = Number(emailAccount.smtp_port || process.env.SMTP_PORT || 587);

  const secure =
    emailAccount.smtp_secure !== undefined
      ? emailAccount.smtp_secure
      : process.env.SMTP_SECURE === "true";

  const user = emailAccount.smtp_username || process.env.SMTP_USER;

  const pass = emailAccount.smtp_password || process.env.SMTP_PASSWORD;

  if (!user || !pass) {
    throw new Error("SMTP credentials are not configured");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

const transporter = createSmtpTransporter();

async function verifySMTP() {
  await transporter.verify();

  console.log("[SMTP] SMTP connection verified");
}

async function verifyAccountSMTP(emailAccount) {
  const accountTransporter = createSmtpTransporter(emailAccount);

  await accountTransporter.verify();

  console.log(`[SMTP][Account ${emailAccount.id}] SMTP connection verified`);

  return true;
}

module.exports = {
  createSmtpTransporter,
  transporter,
  verifySMTP,
  verifyAccountSMTP,
};
