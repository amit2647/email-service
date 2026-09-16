const { ImapFlow } = require("imapflow");

function createImapClient(emailAccount = {}) {
  return new ImapFlow({
    host: emailAccount.imap_host || process.env.IMAP_HOST || "imap.gmail.com",

    port: Number(emailAccount.imap_port || process.env.IMAP_PORT || 993),

    secure:
      emailAccount.imap_secure !== undefined
        ? emailAccount.imap_secure
        : process.env.IMAP_SECURE !== "false",

    auth: {
      user:
        emailAccount.imap_username ||
        process.env.IMAP_USER ||
        process.env.SMTP_USER,

      pass:
        emailAccount.imap_password ||
        process.env.IMAP_PASSWORD ||
        process.env.SMTP_PASSWORD,
    },

    logger: false,
  });
}

async function verifyIMAP() {
  const client = createImapClient();

  try {
    await client.connect();

    const mailbox = process.env.IMAP_MAILBOX || "INBOX";

    const mailboxInfo = await client.mailboxOpen(mailbox);

    console.log(
      `[IMAP] Connection verified: ${mailbox} (${mailboxInfo.exists} messages)`,
    );

    await client.logout();

    return true;
  } catch (error) {
    console.error("[IMAP] Connection verification failed:", error);

    try {
      await client.logout();
    } catch (logoutError) {
      console.error("[IMAP] Logout failed:", logoutError.message);
    }

    throw error;
  }
}

module.exports = {
  createImapClient,
  verifyIMAP,
};
