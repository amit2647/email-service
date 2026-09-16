require("dotenv").config();

const app = require("./app");

const { testDatabaseConnection } = require("./config/database");
const { initializeDatabase } = require("./db/initialize");
const { verifySMTP } = require("./config/smtp");
const { startEmailReceiver } = require("./workers/emailReceiver");

const PORT = Number(process.env.PORT || 4006);

async function startServer() {
  try {
    await testDatabaseConnection();

    await initializeDatabase();

    await verifySMTP();

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
