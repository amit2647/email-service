const express = require("express");

const emailRoutes = require("./routes/emailRoutes");
const requestLogger = require("./middleware/requestLogger");

const app = express();

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
