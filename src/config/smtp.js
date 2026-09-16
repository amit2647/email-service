const nodemailer = require("nodemailer");

function createSmtpTransporter(emailAccount) {
  if (!emailAccount) {
    throw new Error("Email account configuration is required");
  }

  if (!emailAccount.smtp_host) {
    throw new Error(
      `SMTP host is not configured for email account ${emailAccount.id}`,
    );
  }

  if (!emailAccount.smtp_username) {
    throw new Error(
      `SMTP username is not configured for email account ${emailAccount.id}`,
    );
  }

  if (!emailAccount.smtp_password) {
    throw new Error(
      `SMTP password is not configured for email account ${emailAccount.id}`,
    );
  }

  return nodemailer.createTransport({
    host: emailAccount.smtp_host,
    port: Number(emailAccount.smtp_port || 587),
    secure: emailAccount.smtp_secure === true,
    auth: {
      user: emailAccount.smtp_username,
      pass: emailAccount.smtp_password,
    },
  });
}

async function verifyAccountSMTP(emailAccount) {
  const accountTransporter = createSmtpTransporter(emailAccount);

  await accountTransporter.verify();

  console.log(`[SMTP][Account ${emailAccount.id}] SMTP connection verified`);

  return true;
}

module.exports = {
  createSmtpTransporter,
  verifyAccountSMTP,
};
