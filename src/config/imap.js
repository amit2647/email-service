const { ImapFlow } = require("imapflow");

function createImapClient(emailAccount) {
  if (!emailAccount) {
    throw new Error("Email account configuration is required");
  }

  if (!emailAccount.imap_host) {
    throw new Error(
      `IMAP host is not configured for email account ${emailAccount.id}`,
    );
  }

  if (!emailAccount.imap_username) {
    throw new Error(
      `IMAP username is not configured for email account ${emailAccount.id}`,
    );
  }

  if (!emailAccount.imap_password) {
    throw new Error(
      `IMAP password is not configured for email account ${emailAccount.id}`,
    );
  }

  return new ImapFlow({
    host: emailAccount.imap_host,
    port: Number(emailAccount.imap_port || 993),
    secure: emailAccount.imap_secure !== false,
    auth: {
      user: emailAccount.imap_username,
      pass: emailAccount.imap_password,
    },
    logger: false,
  });
}

async function verifyAccountIMAP(emailAccount) {
  const client = createImapClient(emailAccount);
  const mailbox = emailAccount.imap_mailbox || "INBOX";

  try {
    await client.connect();

    const mailboxInfo = await client.mailboxOpen(mailbox);

    console.log(
      `[IMAP][Account ${emailAccount.id}] Connection verified: ${mailbox} (${mailboxInfo.exists} messages)`,
    );

    await client.logout();

    return true;
  } catch (error) {
    console.error(
      `[IMAP][Account ${emailAccount.id}] Connection verification failed:`,
      error,
    );

    try {
      await client.logout();
    } catch (logoutError) {
      console.error(
        `[IMAP][Account ${emailAccount.id}] Logout failed:`,
        logoutError.message,
      );
    }

    throw error;
  }
}

module.exports = {
  createImapClient,
  verifyAccountIMAP,
};
