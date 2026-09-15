require("dotenv").config();

const app = require("./app");

const { testDatabaseConnection } = require("./config/database");

const { initializeDatabase } = require("./db/initialize");

const { verifySMTP } = require("./config/smtp");

const PORT = Number(process.env.PORT || 4006);

async function startServer() {
  try {
    await testDatabaseConnection();

    await initializeDatabase();

    await verifySMTP();

    app.listen(PORT, () => {
      console.log(`Email Service running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[Email Service] Startup failed:", error);

    process.exit(1);
  }
}

startServer();
