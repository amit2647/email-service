require("dotenv").config();

const app = require("./app");
const { testDatabaseConnection } = require("./config/database");
const { verifyAccountSMTP } = require("./config/smtp");
const { verifyAccountIMAP } = require("./config/imap");
const { getActiveEmailAccounts } = require("./services/emailAccountService");
const { startEmailReceiver } = require("./workers/emailReceiver");

const PORT = Number(process.env.PORT || 4006);

async function verifyEmailAccounts() {
  const emailAccounts = await getActiveEmailAccounts();

  if (!emailAccounts || emailAccounts.length === 0) {
    console.log("[Email Service] No active email accounts configured");
    return;
  }

  console.log(
    `[Email Service] Verifying ${emailAccounts.length} active email account(s)`,
  );

  for (const emailAccount of emailAccounts) {
    try {
      await verifyAccountSMTP(emailAccount);
    } catch (error) {
      console.error(
        `[Email Service] SMTP verification failed for account ${emailAccount.id}:`,
        error.message,
      );
    }

    try {
      await verifyAccountIMAP(emailAccount);
    } catch (error) {
      console.error(
        `[Email Service] IMAP verification failed for account ${emailAccount.id}:`,
        error.message,
      );
    }
  }
}

async function startServer() {
  try {
    await testDatabaseConnection();
    await verifyEmailAccounts();

    app.listen(PORT, async () => {
      console.log(`Email Service running on port ${PORT}`);

      try {
        const receivers = await startEmailReceiver();

        console.log(
          `[Email Service] Inbound email receiver started for ${receivers.length} active account(s)`,
        );
      } catch (error) {
        console.error(
          "[Email Service] Failed to start inbound email receiver:",
          error,
        );
      }
    });
  } catch (error) {
    console.error("[Email Service] Startup failed:", error);
    process.exit(1);
  }
}

startServer();
