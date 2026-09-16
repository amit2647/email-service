const { ImapFlow } = require("imapflow");

function createImapClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.IMAP_PORT || 993),
    secure: process.env.IMAP_SECURE !== "false",
    auth: {
      user: process.env.IMAP_USER || process.env.SMTP_USER,
      pass: process.env.IMAP_PASSWORD || process.env.SMTP_PASSWORD,
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
