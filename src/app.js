const express = require("express");

const emailRoutes = require("./routes/emailRoutes");

const app = express();

app.use(express.json());

/*
 * Health
 */

app.get("/health", (req, res) => {
  res.json({
    service: "smtp-service",
    status: "ok",
  });
});

/*
 * Email API
 */

app.use("/emails", emailRoutes);

module.exports = app;
