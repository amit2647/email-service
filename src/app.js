const express = require("express");
const cors = require("cors");
const emailRoutes = require("./routes/emailRoutes");
const emailAccountRoutes = require("./routes/emailAccountRoutes");
const emailTemplateRoutes = require("./routes/emailTemplateRoutes");
const emailAutomationRoutes = require("./routes/emailAutomationRoutes");
const requestLogger = require("./middleware/requestLogger");

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use(requestLogger);

app.get("/health", (req, res) => {
  res.json({
    service: "email-service",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use("/emails", emailRoutes);
app.use("/emails/accounts", emailAccountRoutes);
app.use("/emails/templates", emailTemplateRoutes);
app.use("/emails/automations", emailAutomationRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

app.use((error, req, res, next) => {
  console.error("[Application Error]", error);

  res.status(500).json({
    error: "Internal server error",
  });
});

module.exports = app;
