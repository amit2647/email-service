const emailAccountService = require("../services/emailAccountService");

function getOrganizationId(req) {
  const organizationId = Number(req.auth?.organizationId);

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    const error = new Error("Authenticated organization is required");
    error.statusCode = 401;
    throw error;
  }

  return organizationId;
}

function getAccountId(req) {
  const emailAccountId = Number(req.params.id);

  if (!Number.isInteger(emailAccountId) || emailAccountId <= 0) {
    const error = new Error("Invalid email account ID");
    error.statusCode = 400;
    throw error;
  }

  return emailAccountId;
}

function handleError(res, error) {
  console.error("[Email Account Controller]", error);

  return res.status(error.statusCode || 500).json({
    error: error.message || "Internal server error",
    ...(error.details ? { details: error.details } : {}),
  });
}

async function createAccount(req, res) {
  try {
    const organizationId = getOrganizationId(req);

    const account = await emailAccountService.createEmailAccount(
      organizationId,
      req.body || {},
    );

    return res.status(201).json({
      account,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getAccounts(req, res) {
  try {
    const organizationId = getOrganizationId(req);

    const accounts = await emailAccountService.getEmailAccounts(organizationId);

    return res.json({
      accounts,
      count: accounts.length,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getAccount(req, res) {
  try {
    const organizationId = getOrganizationId(req);

    const emailAccountId = getAccountId(req);

    const account = await emailAccountService.getEmailAccountById(
      organizationId,
      emailAccountId,
    );

    if (!account) {
      return res.status(404).json({
        error: "Email account not found",
      });
    }

    return res.json({
      account,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateAccount(req, res) {
  try {
    const organizationId = getOrganizationId(req);

    const emailAccountId = getAccountId(req);

    const account = await emailAccountService.updateEmailAccount(
      organizationId,
      emailAccountId,
      req.body || {},
    );

    return res.json({
      account,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function activateAccount(req, res) {
  try {
    const organizationId = getOrganizationId(req);

    const emailAccountId = getAccountId(req);

    const account = await emailAccountService.setEmailAccountStatus(
      organizationId,
      emailAccountId,
      true,
    );

    return res.json({
      account,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deactivateAccount(req, res) {
  try {
    const organizationId = getOrganizationId(req);

    const emailAccountId = getAccountId(req);

    const account = await emailAccountService.setEmailAccountStatus(
      organizationId,
      emailAccountId,
      false,
    );

    return res.json({
      account,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteAccount(req, res) {
  try {
    const organizationId = getOrganizationId(req);

    const emailAccountId = getAccountId(req);

    await emailAccountService.deleteEmailAccount(
      organizationId,
      emailAccountId,
    );

    return res.status(204).send();
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  activateAccount,
  deactivateAccount,
  deleteAccount,
};
