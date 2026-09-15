require("dotenv").config();

const app = require("./app");
const { verifySMTP } = require("./config/smtp");

const PORT = Number(process.env.PORT || 4004);

async function start() {
  try {
    await verifySMTP();

    app.listen(PORT, () => {
      console.log(`[SMTP SERVICE] Running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[SMTP SERVICE] Failed to initialize:", error);

    process.exit(1);
  }
}

start();
